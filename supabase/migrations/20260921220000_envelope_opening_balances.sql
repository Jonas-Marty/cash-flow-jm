-- Your accounts held 62,712.31 before the app started tracking anything, and no
-- envelope owned a franc of it. Until it is assigned, the books cannot close.
--
-- Assigned once per rolling envelope, stored rather than derived — it is a
-- statement about the past, not something recomputable from transactions.
-- Excluded for scopes, which are funded from their envelope when they close.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS opening_balance numeric(14,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.category_savings_balance(p_as_of date)
 RETURNS TABLE(category_id uuid, name text, archived boolean, cumulative_balance numeric, month_activity numeric, from_transactions numeric, from_reallocations numeric, from_sweeps numeric, from_allocations numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + INTERVAL '1 month')::date;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH savings AS (
    SELECT c.id, c.name, c.archived, c.is_scope, c.opening_balance
      FROM public.categories c
     WHERE c.user_id = v_uid AND c.rolls_over = true
  ),
  -- transactions credited/debited directly on the envelope
  tx AS (
    SELECT t.category_id,
      SUM(CASE
        WHEN t.type = 'income' AND t.occurred_on <= p_as_of THEN t.amount
        WHEN t.type = 'expense' AND t.occurred_on <= p_as_of THEN -t.amount
        ELSE 0 END) AS cum,
      SUM(CASE
        WHEN t.type = 'income' AND t.occurred_on >= v_month_start AND t.occurred_on < v_month_end THEN t.amount
        WHEN t.type = 'expense' AND t.occurred_on >= v_month_start AND t.occurred_on < v_month_end THEN -t.amount
        ELSE 0 END) AS mth
    FROM public.transactions t
    JOIN savings s ON s.id = t.category_id
    WHERE t.user_id = v_uid
    GROUP BY t.category_id
  ),
  -- the monthly allocation, credited in full on day 1 of each month.
  -- Scopes are excluded: they sit outside the monthly plan.
  alloc AS (
    SELECT cb.category_id AS cid,
      SUM(CASE WHEN cb.month <= p_as_of THEN cb.amount ELSE 0 END) AS cum,
      SUM(CASE WHEN cb.month = v_month_start THEN cb.amount ELSE 0 END) AS mth
    FROM public.category_budgets cb
    JOIN savings s ON s.id = cb.category_id
    WHERE s.is_scope = false
    GROUP BY cb.category_id
  ),
  -- What the envelope already held on day one. Assigned once in Settings, not
  -- derived, and deliberately excluded for scopes, which are funded at close.
  opening AS (
    SELECT s.id AS cid, COALESCE(s.opening_balance, 0) AS cum
      FROM savings s WHERE s.is_scope = false
  ),
  rin AS (
    SELECT r.to_category_id AS cid,
      SUM(CASE WHEN r.occurred_on <= p_as_of THEN r.amount ELSE 0 END) AS cum,
      SUM(CASE WHEN r.occurred_on >= v_month_start AND r.occurred_on < v_month_end THEN r.amount ELSE 0 END) AS mth
    FROM public.category_reallocations r
    WHERE r.user_id = v_uid
    GROUP BY r.to_category_id
  ),
  rout AS (
    SELECT r.from_category_id AS cid,
      SUM(CASE WHEN r.occurred_on <= p_as_of THEN r.amount ELSE 0 END) AS cum,
      SUM(CASE WHEN r.occurred_on >= v_month_start AND r.occurred_on < v_month_end THEN r.amount ELSE 0 END) AS mth
    FROM public.category_reallocations r
    WHERE r.user_id = v_uid
    GROUP BY r.from_category_id
  ),
  default_target AS (
    SELECT default_sweep_category_id AS tgt FROM public.settings WHERE user_id = v_uid LIMIT 1
  ),
  -- Leftovers swept from non-rolling envelopes, fully-elapsed months only.
  per_env_months AS (
    SELECT cb.category_id, cb.month, cb.amount AS allocated,
           COALESCE(c.sweep_target_category_id, g.sweep_target_category_id, (SELECT tgt FROM default_target)) AS target_cid
      FROM public.category_budgets cb
      JOIN public.categories c ON c.id = cb.category_id
      LEFT JOIN public.category_groups g ON g.id = c.group_id
     WHERE c.user_id = v_uid
       AND c.rolls_over = false
       AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
       AND cb.month + INTERVAL '1 month' <= p_as_of
  ),
  per_env_spent AS (
    SELECT pem.category_id, pem.month, pem.allocated, pem.target_cid,
      COALESCE((
        SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                        WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
        FROM public.transactions t
        WHERE t.category_id = pem.category_id
          AND t.user_id = v_uid
          AND t.occurred_on >= pem.month
          AND t.occurred_on < (pem.month + INTERVAL '1 month')
      ), 0) AS spent
    FROM per_env_months pem
  ),
  sweeps AS (
    SELECT target_cid AS cid,
           SUM(allocated - spent) AS cum
    FROM per_env_spent
    WHERE target_cid IS NOT NULL
    GROUP BY target_cid
  )
  SELECT
    s.id, s.name, s.archived,
    COALESCE(tx.cum, 0) + COALESCE(alloc.cum, 0) + COALESCE(opening.cum, 0) + COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) + COALESCE(sweeps.cum, 0) AS cumulative_balance,
    COALESCE(tx.mth, 0) + COALESCE(alloc.mth, 0) + COALESCE(rin.mth, 0) - COALESCE(rout.mth, 0) AS month_activity,
    COALESCE(tx.cum, 0) AS from_transactions,
    COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) AS from_reallocations,
    COALESCE(sweeps.cum, 0) AS from_sweeps,
    COALESCE(alloc.cum, 0) + COALESCE(opening.cum, 0) AS from_allocations
  FROM savings s
  LEFT JOIN tx ON tx.category_id = s.id
  LEFT JOIN alloc ON alloc.cid = s.id
  LEFT JOIN opening ON opening.cid = s.id
  LEFT JOIN rin ON rin.cid = s.id
  LEFT JOIN rout ON rout.cid = s.id
  LEFT JOIN sweeps ON sweeps.cid = s.id;
END;
$function$

;

REVOKE ALL ON FUNCTION public.category_savings_balance(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_savings_balance(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.envelope_reconciliation(p_as_of date)
 RETURNS TABLE(accounts_total numeric, rollover_total numeric, expense_open numeric, income_open numeric, outstanding_reimbursements numeric, unallocated numeric, residual numeric)
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
  v_unassigned_openings numeric := 0;
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

  -- Opening money not yet handed to an envelope. Same predicate the balance
  -- function counts, so what one adds the other drops.
  SELECT COALESCE((SELECT SUM(a.opening_balance) FROM public.accounts a
                    WHERE a.user_id = v_uid AND a.archived = false), 0)
       - COALESCE((SELECT SUM(c.opening_balance) FROM public.categories c
                    WHERE c.user_id = v_uid AND c.rolls_over = true AND c.is_scope = false), 0)
    INTO v_unassigned_openings;

  -- Partitioned so outstanding_reimbursements is not counted twice.
  v_unallocated := v_uncat - v_outstanding + v_fx + v_plan_gap + v_unassigned_openings;

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
