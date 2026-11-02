-- AI usage: which connection served each request, and totals per period.
--
-- The AI log recorded the provider host and model but not the connection, so two
-- connections on one host could not be told apart, and a request that reached a
-- fallback connection looked like any other. Each request now records the
-- connection it ran on, the one it was meant for, and that connection's name at
-- the time (the log outlives a deleted connection, so there is no foreign key).
--
-- "Protokoll leeren" used to delete the rows, and with them every usage figure.
-- It now blanks what was sent and received and keeps the numbers: cleared rows
-- leave the log view and stay in the usage totals.

ALTER TABLE public.ai_audit_logs
  ADD COLUMN IF NOT EXISTS endpoint_id uuid,
  ADD COLUMN IF NOT EXISTS endpoint_name text,
  ADD COLUMN IF NOT EXISTS intended_endpoint_id uuid,
  ADD COLUMN IF NOT EXISTS cached_tokens integer,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

-- Reading a recurring rule from an invoice was logged as a statement read.
ALTER TABLE public.ai_audit_logs DROP CONSTRAINT IF EXISTS ai_audit_logs_kind_check;
ALTER TABLE public.ai_audit_logs ADD CONSTRAINT ai_audit_logs_kind_check CHECK (kind = ANY (ARRAY[
  'chat_request', 'tool_call', 'document_extract', 'statement_classify',
  'pending_enrich', 'transcribe', 'recurring_extract'
]));

UPDATE public.ai_audit_logs
   SET kind = 'recurring_extract'
 WHERE kind = 'document_extract' AND payload->>'part' = 'recurring_rule';

-- Older rows: attribute them to a connection where host and model leave only one
-- candidate, or where the host alone does (a model since removed from it). Rows
-- that stay ambiguous keep endpoint_id null and are grouped by host.
WITH ep AS (
  SELECT e.id, e.user_id, e.name,
         substring(e.base_url from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]+)') AS host,
         array_remove(
           array_cat(ARRAY[e.model, e.transcribe_model], COALESCE(e.extra_models, '{}'))
           || COALESCE((SELECT array_agg(b.model) FROM public.ai_action_endpoints b
                         WHERE b.endpoint_id = e.id AND b.model IS NOT NULL), '{}'),
           NULL) AS models
    FROM public.ai_endpoints e
),
pick AS (
  SELECT l.id AS log_id,
         COALESCE(
           (SELECT min(ep.id::text)::uuid FROM ep
             WHERE ep.user_id = l.user_id AND ep.host = l.provider_host AND l.model = ANY (ep.models)
            HAVING count(*) = 1),
           (SELECT min(ep.id::text)::uuid FROM ep
             WHERE ep.user_id = l.user_id AND ep.host = l.provider_host
            HAVING count(*) = 1)
         ) AS endpoint_id
    FROM public.ai_audit_logs l
   WHERE l.endpoint_id IS NULL AND l.provider_host IS NOT NULL
)
UPDATE public.ai_audit_logs l
   SET endpoint_id = pick.endpoint_id,
       endpoint_name = (SELECT name FROM public.ai_endpoints WHERE id = pick.endpoint_id)
  FROM pick
 WHERE l.id = pick.log_id AND pick.endpoint_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_audit_logs_user_open_idx
  ON public.ai_audit_logs (user_id, occurred_at DESC) WHERE cleared_at IS NULL;

-- Totals per day, connection, model and feature, for the caller's own requests.
-- Tool calls are actions the assistant took, not model requests, and stay out.
-- SECURITY DEFINER because it names connections, and ai_endpoints (which holds the
-- API tokens) is not readable by the client; every row is filtered to auth.uid().
-- p_from and p_to are days in p_tz, both included.
CREATE OR REPLACE FUNCTION public.ai_usage(p_from date, p_to date, p_tz text DEFAULT 'Europe/Zurich')
RETURNS TABLE(
  day date,
  endpoint_id uuid,
  connection text,
  connection_exists boolean,
  model text,
  model_configured boolean,
  kind text,
  requests integer,
  prompt_tokens bigint,
  completion_tokens bigint,
  cached_tokens bigint,
  without_usage integer,
  failed integer,
  duration_ms bigint,
  timed integer,
  fallback integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    (l.occurred_at AT TIME ZONE p_tz)::date,
    l.endpoint_id,
    COALESCE(e.name, l.endpoint_name, l.provider_host, '—'),
    e.id IS NOT NULL,
    COALESCE(l.model, '—'),
    CASE WHEN e.id IS NULL THEN false
         ELSE l.model = e.model OR l.model = e.transcribe_model OR l.model = ANY (COALESCE(e.extra_models, '{}'))
              OR EXISTS (SELECT 1 FROM public.ai_action_endpoints b WHERE b.endpoint_id = e.id AND b.model = l.model)
    END,
    l.kind,
    count(*)::int,
    COALESCE(sum(l.prompt_tokens), 0)::bigint,
    COALESCE(sum(l.completion_tokens), 0)::bigint,
    COALESCE(sum(l.cached_tokens), 0)::bigint,
    count(*) FILTER (WHERE l.total_tokens IS NULL AND l.prompt_tokens IS NULL AND l.completion_tokens IS NULL)::int,
    count(*) FILTER (WHERE l.ok = false)::int,
    COALESCE(sum(l.duration_ms), 0)::bigint,
    count(l.duration_ms)::int,
    count(*) FILTER (WHERE l.intended_endpoint_id IS NOT NULL AND l.endpoint_id IS DISTINCT FROM l.intended_endpoint_id)::int
  FROM public.ai_audit_logs l
  LEFT JOIN public.ai_endpoints e ON e.id = l.endpoint_id AND e.user_id = l.user_id
  WHERE l.user_id = auth.uid()
    AND l.kind <> 'tool_call'
    AND l.occurred_at >= (p_from::timestamp AT TIME ZONE p_tz)
    AND l.occurred_at < ((p_to + 1)::timestamp AT TIME ZONE p_tz)
  GROUP BY 1, 2, 3, 4, 5, 6, 7;
$function$;

-- Chats in the period: one conversation usually takes several requests.
CREATE OR REPLACE FUNCTION public.ai_usage_chats(p_from date, p_to date, p_tz text DEFAULT 'Europe/Zurich')
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT count(DISTINCT conversation_id)::int
    FROM public.ai_audit_logs
   WHERE user_id = auth.uid() AND kind = 'chat_request' AND conversation_id IS NOT NULL
     AND occurred_at >= (p_from::timestamp AT TIME ZONE p_tz)
     AND occurred_at < ((p_to + 1)::timestamp AT TIME ZONE p_tz);
$function$;

-- "Protokoll leeren": drop what was sent and received, keep the figures.
CREATE OR REPLACE FUNCTION public.clear_ai_audit_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  UPDATE public.ai_audit_logs
     SET payload = '{}'::jsonb, error_message = NULL, cleared_at = now()
   WHERE user_id = auth.uid() AND cleared_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.ai_usage(date, date, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.ai_usage_chats(date, date, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.clear_ai_audit_log() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ai_usage(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_chats(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_ai_audit_log() TO authenticated;
