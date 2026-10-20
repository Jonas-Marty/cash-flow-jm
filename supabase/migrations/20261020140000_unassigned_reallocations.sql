-- Money that belongs to no budget yet, and assigning it to one.
--
-- 1. A reallocation can have one side empty, meaning "Nicht zugeordnet": with
--    no source it hands unassigned money to a budget, with no target it gives a
--    budget's money back. Never both empty. transaction_id links a
--    reallocation to the transfer it came from (gift card bought at a
--    discount), and goes with it when the transfer is deleted.
--
-- 2. envelope_reconciliation counts those reallocations against unallocated,
--    so assigning keeps the books closed, and returns what unallocated is made
--    of so the Budgets page can explain the number:
--      openings       account opening balances not given to an envelope
--      uncategorized  transactions without a category (not open reimbursements)
--      transfers      transfers that received more or less than they sent
--      plan_gap       planned income that the plan did not hand out
--      assigned       minus what was assigned by hand from here
--    The return type changes, so the function is dropped first; only the
--    browser calls it.
--
-- category_savings_balance and category_ledger need no change: they count a
-- reallocation for the budget on each side it has.

ALTER TABLE public.category_reallocations
  ALTER COLUMN from_category_id DROP NOT NULL,
  ALTER COLUMN to_category_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.transactions(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_reallocations_has_a_side') THEN
    ALTER TABLE public.category_reallocations
      ADD CONSTRAINT category_reallocations_has_a_side
      CHECK (from_category_id IS NOT NULL OR to_category_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'category_reallocations_one_per_transaction') THEN
    ALTER TABLE public.category_reallocations
      ADD CONSTRAINT category_reallocations_one_per_transaction UNIQUE (transaction_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_category_reallocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_savings boolean;
  v_to_savings boolean;
  v_from_user uuid;
  v_to_user uuid;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'reallocation amount must be greater than zero';
  END IF;
  IF NEW.from_category_id IS NULL AND NEW.to_category_id IS NULL THEN
    RAISE EXCEPTION 'a reallocation needs a source or a target envelope';
  END IF;
  IF NEW.from_category_id = NEW.to_category_id THEN
    RAISE EXCEPTION 'reallocation source and target must differ';
  END IF;

  IF NEW.from_category_id IS NOT NULL THEN
    SELECT rolls_over, user_id INTO v_from_savings, v_from_user
      FROM public.categories WHERE id = NEW.from_category_id;
    IF v_from_savings IS NOT TRUE THEN
      RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
    END IF;
    IF v_from_user <> NEW.user_id THEN
      RAISE EXCEPTION 'reallocation categories must belong to the same user';
    END IF;
  END IF;
  IF NEW.to_category_id IS NOT NULL THEN
    SELECT rolls_over, user_id INTO v_to_savings, v_to_user
      FROM public.categories WHERE id = NEW.to_category_id;
    IF v_to_savings IS NOT TRUE THEN
      RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
    END IF;
    IF v_to_user <> NEW.user_id THEN
      RAISE EXCEPTION 'reallocation categories must belong to the same user';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP FUNCTION IF EXISTS public.envelope_reconciliation(date);

CREATE OR REPLACE FUNCTION public.envelope_reconciliation(p_as_of date)
 RETURNS TABLE(accounts_total numeric, rollover_total numeric, expense_open numeric, income_open numeric, outstanding_reimbursements numeric, unallocated numeric, residual numeric,
               unallocated_openings numeric, unallocated_uncategorized numeric, unallocated_transfers numeric, unallocated_plan_gap numeric, unallocated_assigned numeric)
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
  v_assigned numeric := 0;
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

  -- Assigned by hand: a reallocation with no source budget takes money out of
  -- here into a budget; one with no target gives it back.
  SELECT COALESCE(SUM(CASE WHEN r.from_category_id IS NULL THEN -r.amount
                           WHEN r.to_category_id IS NULL THEN r.amount ELSE 0 END), 0)
    INTO v_assigned
    FROM public.category_reallocations r
   WHERE r.user_id = v_uid AND r.occurred_on <= p_as_of
     AND (r.from_category_id IS NULL OR r.to_category_id IS NULL);

  -- Partitioned so outstanding_reimbursements is not counted twice.
  v_unallocated := v_uncat - v_outstanding + v_fx + v_plan_gap + v_unassigned_openings + v_assigned;

  accounts_total := v_accounts;
  rollover_total := v_rollover;
  expense_open := v_expense_open;
  income_open := v_income_open;
  outstanding_reimbursements := v_outstanding;
  unallocated := v_unallocated;
  residual := v_accounts - (v_rollover + v_expense_open + v_income_open + v_outstanding + v_unallocated);
  unallocated_openings := v_unassigned_openings;
  unallocated_uncategorized := v_uncat - v_outstanding;
  unallocated_transfers := v_fx;
  unallocated_plan_gap := v_plan_gap;
  unallocated_assigned := v_assigned;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.envelope_reconciliation(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.envelope_reconciliation(date) TO authenticated;
