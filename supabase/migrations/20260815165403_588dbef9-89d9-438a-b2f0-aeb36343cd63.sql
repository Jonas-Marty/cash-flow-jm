ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS last_recurring_sweep_on date;

CREATE OR REPLACE FUNCTION public.process_recurring_rules_if_stale(p_today date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Claim the sweep for today. If another tab/device already claimed it,
  -- no row is updated and we skip the (idempotent but non-trivial) work.
  UPDATE public.settings
     SET last_recurring_sweep_on = p_today
   WHERE user_id = v_uid
     AND (last_recurring_sweep_on IS NULL OR last_recurring_sweep_on < p_today);
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN false;
  END IF;

  PERFORM public.process_recurring_rules(p_today);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.process_recurring_rules_if_stale(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_recurring_rules_if_stale(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules_if_stale(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules_if_stale(date) TO service_role;