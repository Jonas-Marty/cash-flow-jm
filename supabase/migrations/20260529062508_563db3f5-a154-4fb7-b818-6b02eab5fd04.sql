CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_action    TEXT;
  v_diff      JSONB := '{}'::jsonb;
  v_old_json  JSONB;
  v_new_json  JSONB;
  v_row_id    TEXT;
  v_owner     UUID;
  k           TEXT;
  v_sensitive TEXT[];
BEGIN
  -- Per-table sensitive column allowlist. Values for these columns are
  -- redacted before being written to audit_logs to avoid leaking secrets
  -- (OAuth tokens, client secrets, API token hashes, etc.).
  v_sensitive := CASE TG_TABLE_NAME
    WHEN 'nextcloud_connections' THEN ARRAY['client_secret','access_token','refresh_token']
    WHEN 'api_tokens' THEN ARRAY['token_hash']
    WHEN 'auth_providers' THEN ARRAY['client_id']
    ELSE ARRAY[]::TEXT[]
  END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new_json := to_jsonb(NEW);
    FOREACH k IN ARRAY v_sensitive LOOP
      IF v_new_json ? k THEN
        v_new_json := jsonb_set(v_new_json, ARRAY[k], to_jsonb('[redacted]'::text));
      END IF;
    END LOOP;
    v_diff := v_new_json;
    v_row_id := COALESCE((v_new_json->>'id'), '');
    v_owner  := NULLIF(v_new_json->>'user_id','')::uuid;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old_json := to_jsonb(OLD);
    FOREACH k IN ARRAY v_sensitive LOOP
      IF v_old_json ? k THEN
        v_old_json := jsonb_set(v_old_json, ARRAY[k], to_jsonb('[redacted]'::text));
      END IF;
    END LOOP;
    v_diff := v_old_json;
    v_row_id := COALESCE((v_old_json->>'id'), '');
    v_owner  := NULLIF(v_old_json->>'user_id','')::uuid;
  ELSE -- UPDATE
    v_action := 'update';
    v_old_json := to_jsonb(OLD);
    v_new_json := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(v_new_json) LOOP
      IF (v_old_json->k) IS DISTINCT FROM (v_new_json->k)
         AND k NOT IN ('updated_at') THEN
        IF k = ANY (v_sensitive) THEN
          v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', '[redacted]', 'new', '[redacted]'));
        ELSE
          v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('old', v_old_json->k, 'new', v_new_json->k));
        END IF;
      END IF;
    END LOOP;
    v_row_id := COALESCE((v_new_json->>'id'), '');
    v_owner  := NULLIF(v_new_json->>'user_id','')::uuid;
    IF v_diff = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(user_id, action, table_name, row_id, diff)
  VALUES (COALESCE(v_uid, v_owner), v_action, TG_TABLE_NAME, NULLIF(v_row_id,''), v_diff);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- Scrub existing audit log entries that already captured these secrets.
UPDATE public.audit_logs
   SET diff = (
     SELECT jsonb_object_agg(
       key,
       CASE
         WHEN key IN ('client_secret','access_token','refresh_token') THEN
           CASE
             WHEN jsonb_typeof(value) = 'object' AND (value ? 'old' OR value ? 'new')
               THEN jsonb_build_object('old','[redacted]','new','[redacted]')
             ELSE to_jsonb('[redacted]'::text)
           END
         ELSE value
       END)
     FROM jsonb_each(diff)
   )
 WHERE table_name = 'nextcloud_connections'
   AND diff IS NOT NULL
   AND (diff ? 'client_secret' OR diff ? 'access_token' OR diff ? 'refresh_token');

UPDATE public.audit_logs
   SET diff = (
     SELECT jsonb_object_agg(
       key,
       CASE
         WHEN key = 'token_hash' THEN
           CASE
             WHEN jsonb_typeof(value) = 'object' AND (value ? 'old' OR value ? 'new')
               THEN jsonb_build_object('old','[redacted]','new','[redacted]')
             ELSE to_jsonb('[redacted]'::text)
           END
         ELSE value
       END)
     FROM jsonb_each(diff)
   )
 WHERE table_name = 'api_tokens'
   AND diff IS NOT NULL
   AND (diff ? 'token_hash');