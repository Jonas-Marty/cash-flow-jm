DO $$
DECLARE
  r record;
  keep_args constant text := 'p_template text, p_due date, p_date date, p_period_from date, p_period_to date, p_run integer, p_locale text';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'interpolate_template'
      AND pg_get_function_identity_arguments(p.oid) <> keep_args
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;