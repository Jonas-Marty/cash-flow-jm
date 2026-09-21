-- Every franc in an account should sit in exactly one envelope.
--
-- envelope_reconciliation returns each term of that identity plus what is left
-- over, so the books can be *shown* to balance rather than assumed to. It is
-- purely additive here: nothing about how balances are computed changes, and
-- the residual is expected to be large until opening balances and the income
-- conduit land. Proving the gap comes before closing it.
--
--   accounts_total = rollover_total + expense_open + income_open
--                  + outstanding_reimbursements + unallocated + residual
--
-- Replaces reconciliation_summary, whose `drift` compared accounts against
-- envelope balances that had never been allocated anything, so it could not be
-- read as either right or wrong.

DROP FUNCTION IF EXISTS public.reconciliation_summary(date);

-- category_savings_balance and this function both walk transactions per
-- category per month.
CREATE INDEX IF NOT EXISTS idx_tx_user_cat_date
  ON public.transactions (user_id, category_id, occurred_on);

CREATE OR REPLACE FUNCTION public.envelope_reconciliation(p_as_of date)
RETURNS TABLE(
  accounts_total numeric,
  rollover_total numeric,
  expense_open numeric,
  income_open numeric,
  outstanding_reimbursements numeric,
  unallocated numeric,
  residual numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_accounts numeric := 0;
  v_rollover numeric := 0;
  v_expense_open numeric := 0;
  v_income_open numeric := 0;
  v_outstanding numeric := 0;
  v_uncat numeric := 0;
  v_fx numeric := 0;
  v_plan_gap numeric := 0;
  v_unallocated numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Real money: openings, plus every transaction that moved any.
  SELECT COALESCE(SUM(
    a.opening_balance
    + COALESCE((
        SELECT SUM(CASE WHEN t.type = 'expense' THEN -t.amount
                        WHEN t.type = 'income' THEN t.amount
                        WHEN t.type = 'transfer' THEN -t.amount END)
        FROM public.transactions t
        WHERE t.source_account_id = a.id AND t.user_id = v_uid AND t.occurred_on <= p_as_of
      ), 0)
    + COALESCE((
        SELECT SUM(COALESCE(t.destination_amount, t.amount))
        FROM public.transactions t
        WHERE t.destination_account_id = a.id AND t.user_id = v_uid
          AND t.type = 'transfer' AND t.occurred_on <= p_as_of
      ), 0)
  ), 0)
  INTO v_accounts
  FROM public.accounts a
  WHERE a.user_id = v_uid AND a.archived = false;

  -- Envelopes that carry forward, including scopes.
  SELECT COALESCE(SUM(cumulative_balance), 0)
    INTO v_rollover
    FROM public.category_savings_balance(p_as_of);

  -- Envelopes that reset monthly hold only the current month's remainder;
  -- earlier months have already been swept into the target.
  SELECT COALESCE(SUM(cb.amount - COALESCE((
            SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                            WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
            FROM public.transactions t
            WHERE t.category_id = cb.category_id AND t.user_id = v_uid
              AND t.occurred_on >= v_month_start AND t.occurred_on <= p_as_of
         ), 0)), 0)
    INTO v_expense_open
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    LEFT JOIN public.category_groups g ON g.id = c.group_id
   WHERE c.user_id = v_uid
     AND c.rolls_over = false
     AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
     AND cb.month = v_month_start;

  -- An income envelope is a conduit: it starts the month owing the plan and is
  -- settled when the salary lands. Negative before payday, zero after.
  SELECT COALESCE(SUM(COALESCE((
            SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount
                            WHEN t.type = 'expense' THEN -t.amount ELSE 0 END)
            FROM public.transactions t
            WHERE t.category_id = cb.category_id AND t.user_id = v_uid
              AND t.occurred_on >= v_month_start AND t.occurred_on <= p_as_of
         ), 0) - cb.amount), 0)
    INTO v_income_open
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    JOIN public.category_groups g ON g.id = c.group_id
   WHERE c.user_id = v_uid
     AND c.rolls_over = false
     AND g.kind = 'income'
     AND cb.month = v_month_start;

  -- Money you laid out for someone else and have not got back. It belongs to no
  -- envelope because it is an asset in transit, not spending. Only the
  -- uncategorised ones: a categorised original is already charged to its
  -- envelope, where the refund nets against it.
  SELECT COALESCE(-SUM(GREATEST(0, t.amount - COALESCE((
            SELECT SUM(l.amount) FROM public.transaction_reimbursements l
             JOIN public.transactions st ON st.id = l.settling_transaction_id
             WHERE l.original_transaction_id = t.id AND st.occurred_on <= p_as_of), 0))), 0)
    INTO v_outstanding
    FROM public.transactions t
   WHERE t.user_id = v_uid
     AND t.is_reimbursable = true
     AND t.reimbursable_status = 'open'
     AND t.category_id IS NULL
     AND t.occurred_on <= p_as_of;

  -- Everything else that has to live somewhere for the books to close.
  SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)
    INTO v_uncat
    FROM public.transactions t
   WHERE t.user_id = v_uid AND t.category_id IS NULL
     AND t.type <> 'transfer' AND t.occurred_on <= p_as_of;

  SELECT COALESCE(SUM(COALESCE(t.destination_amount, t.amount) - t.amount), 0)
    INTO v_fx
    FROM public.transactions t
   WHERE t.user_id = v_uid AND t.type = 'transfer' AND t.occurred_on <= p_as_of;

  -- Planned income that was never assigned to an envelope (or over-assigned).
  -- Zero while the plan balances; this is where it surfaces when it stops.
  SELECT COALESCE(SUM(
           CASE WHEN g.kind = 'income' THEN cb.amount ELSE -cb.amount END
         ), 0)
    INTO v_plan_gap
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    LEFT JOIN public.category_groups g ON g.id = c.group_id
   WHERE c.user_id = v_uid
     AND c.is_scope = false
     AND cb.month <= p_as_of;

  -- Partitioned so outstanding_reimbursements is not counted twice.
  v_unallocated := v_uncat - v_outstanding + v_fx + v_plan_gap;

  accounts_total := v_accounts;
  rollover_total := v_rollover;
  expense_open := v_expense_open;
  income_open := v_income_open;
  outstanding_reimbursements := v_outstanding;
  unallocated := v_unallocated;
  residual := v_accounts - (v_rollover + v_expense_open + v_income_open + v_outstanding + v_unallocated);
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.envelope_reconciliation(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.envelope_reconciliation(date) TO authenticated;
