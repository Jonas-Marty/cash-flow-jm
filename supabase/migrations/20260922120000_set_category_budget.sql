-- Budgets could only ever be changed for the current month and whatever followed it.
-- That was never a rule — settings.tsx hard-coded `new Date()` as the write target, so
-- no other month was addressable. Nothing in the schema forbade it: the only CHECK on
-- category_budgets is about day-of-month, and RLS is ownership-only.
--
-- This function makes any month writable, and makes the two intents explicit rather
-- than implied:
--   'month'   — change just that month. Corrections to history.
--   'forward' — change that month and every later one. The new normal.
--
-- 'forward' UPDATEs existing later rows instead of the old delete-and-let-copy-forward-
-- regenerate trick. Deleting made the outcome depend on which months the user happened
-- to have browsed, because merely viewing a month materialises it.
--
-- Editing a month that has already elapsed is not cosmetic: category_savings_balance
-- recomputes both allocations and the month's sweep from these rows on every read, so
-- the change ripples into today's balances. Nothing is snapshotted, so nothing needs
-- repairing — but it should leave a trace, hence the audit entry.

CREATE OR REPLACE FUNCTION public.set_category_budget(
  p_category_id uuid,
  p_month       date,
  p_amount      numeric,
  p_scope       text DEFAULT 'month'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_month    date := date_trunc('month', p_month)::date;
  v_name     text;
  v_is_scope boolean;
  v_old      numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_category_budget requires an authenticated user';
  END IF;

  IF p_scope NOT IN ('month', 'forward') THEN
    RAISE EXCEPTION 'invalid budget scope: %', p_scope;
  END IF;

  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'budget amount is required';
  END IF;

  SELECT c.name, c.is_scope INTO v_name, v_is_scope
    FROM public.categories c
   WHERE c.id = p_category_id AND c.user_id = v_uid;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'category not found';
  END IF;

  -- Scopes are funded from their funding envelope when they close and take no part in
  -- the monthly plan; ensure_month_budgets skips them for the same reason.
  IF v_is_scope THEN
    RAISE EXCEPTION 'scope envelopes have no monthly budget';
  END IF;

  SELECT cb.amount INTO v_old
    FROM public.category_budgets cb
   WHERE cb.category_id = p_category_id AND cb.month = v_month;

  INSERT INTO public.category_budgets (category_id, month, amount)
  VALUES (p_category_id, v_month, p_amount)
  ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount;

  IF p_scope = 'forward' THEN
    UPDATE public.category_budgets
       SET amount = p_amount
     WHERE category_id = p_category_id
       AND month > v_month;

    -- The template only seeds envelopes with no prior row, but leaving it stale would
    -- make Settings show a number that no month actually uses.
    UPDATE public.categories
       SET allocated_budget = p_amount
     WHERE id = p_category_id;
  END IF;

  -- Fully elapsed: its sweep has already been credited to a target on every read since.
  IF v_month + INTERVAL '1 month' <= CURRENT_DATE THEN
    PERFORM public.log_audit_event('custom', jsonb_build_object(
      'event',       'budget.retroactive_change',
      'category_id', p_category_id,
      'category',    v_name,
      'month',       to_char(v_month, 'YYYY-MM'),
      'old_amount',  v_old,
      'new_amount',  p_amount,
      'scope',       p_scope
    ));
  END IF;
END;
$function$;

REVOKE ALL    ON FUNCTION public.set_category_budget(uuid, date, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_category_budget(uuid, date, numeric, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_category_budget(uuid, date, numeric, text) TO authenticated;
