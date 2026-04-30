-- =========================================================
-- AUDIT LOG SYSTEM
-- =========================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID,                       -- auth.uid() at time of change (nullable: cron / system)
  action      TEXT NOT NULL CHECK (action IN ('insert','update','delete','login','logout','token.refresh','custom')),
  table_name  TEXT,                       -- public table affected (null for non-DB events)
  row_id      TEXT,                       -- text so it accepts uuid / bigint / composite
  diff        JSONB,                      -- {field: {old, new}} for updates; full row for insert/delete (compact)
  metadata    JSONB                       -- request id, ip, user agent, custom event payload
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx     ON public.audit_logs(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_table_idx       ON public.audit_logs(table_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON public.audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx      ON public.audit_logs(action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Read: own rows OR admin
CREATE POLICY "read own audit or admin"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- No direct insert/update/delete from clients — only triggers (SECURITY DEFINER) and
-- the SECURITY DEFINER `log_audit_event` RPC may write.
-- (No INSERT/UPDATE/DELETE policies => denied for authenticated role.)

-- =========================================================
-- Generic trigger function: write a compact diff to audit_logs
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_action    TEXT;
  v_diff      JSONB := '{}'::jsonb;
  v_old_json  JSONB;
  v_new_json  JSONB;
  v_row_id    TEXT;
  v_owner     UUID;
  k           TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new_json := to_jsonb(NEW);
    v_diff := v_new_json;                                  -- full row on insert
    v_row_id := COALESCE((v_new_json->>'id'), '');
    v_owner  := NULLIF(v_new_json->>'user_id','')::uuid;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old_json := to_jsonb(OLD);
    v_diff := v_old_json;                                  -- full row on delete
    v_row_id := COALESCE((v_old_json->>'id'), '');
    v_owner  := NULLIF(v_old_json->>'user_id','')::uuid;
  ELSE -- UPDATE: diff only
    v_action := 'update';
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(v_new_json) LOOP
      IF (v_old_json->k) IS DISTINCT FROM (v_new_json->k)
         AND k NOT IN ('updated_at') THEN
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', v_old_json->k, 'new', v_new_json->k));
      END IF;
    END LOOP;
    v_row_id := COALESCE((v_new_json->>'id'), '');
    v_owner  := NULLIF(v_new_json->>'user_id','')::uuid;
    -- Skip writing if nothing actually changed (only updated_at)
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Prefer auth.uid(); fall back to row owner (covers SECURITY DEFINER / trigger contexts)
  INSERT INTO public.audit_logs(user_id, action, table_name, row_id, diff)
  VALUES (COALESCE(v_uid, v_owner), v_action, TG_TABLE_NAME, NULLIF(v_row_id,''), v_diff);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Helper to attach to a list of tables idempotently
DO $$
DECLARE t TEXT;
DECLARE tables TEXT[] := ARRAY[
  'accounts','categories','category_groups','category_budgets','category_reallocations',
  'transactions','recurring_rules','recurring_occurrences',
  'settings','api_tokens','nextcloud_connections','auth_providers','user_roles'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
  END LOOP;
END $$;

-- =========================================================
-- RPC for non-DB events (auth login/logout etc.)
-- =========================================================
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action   TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'log_audit_event requires an authenticated user';
  END IF;
  IF p_action NOT IN ('login','logout','token.refresh','custom') THEN
    RAISE EXCEPTION 'invalid audit action: %', p_action;
  END IF;
  INSERT INTO public.audit_logs(user_id, action, metadata)
  VALUES (v_uid, p_action, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, JSONB) TO authenticated;

-- =========================================================
-- Retention pruning RPC (called by Coolify cron via /api/public/prune-audit)
-- =========================================================
CREATE OR REPLACE FUNCTION public.prune_audit_logs(p_keep_days INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted INT;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be >= 1';
  END IF;
  DELETE FROM public.audit_logs
   WHERE occurred_at < (now() - make_interval(days => p_keep_days));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_audit_logs(INT) FROM PUBLIC;
-- only service role calls this (no GRANT to authenticated)
