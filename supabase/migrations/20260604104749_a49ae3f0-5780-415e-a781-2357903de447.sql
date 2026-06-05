CREATE TABLE public.ai_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('chat_request','tool_call')),
  model text,
  provider_host text,
  tool_name text,
  conversation_id uuid,
  duration_ms integer,
  ok boolean,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX ai_audit_logs_user_time_idx ON public.ai_audit_logs (user_id, occurred_at DESC);

GRANT SELECT, DELETE ON public.ai_audit_logs TO authenticated;
GRANT ALL ON public.ai_audit_logs TO service_role;

ALTER TABLE public.ai_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view their own AI audit logs"
  ON public.ai_audit_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete their own AI audit logs"
  ON public.ai_audit_logs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
