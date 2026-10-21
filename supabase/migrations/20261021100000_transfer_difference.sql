-- Gift cards bought at a discount: one transfer, the difference to a budget.
--
-- Pay 960 from the bank, get a gift card worth 1000: a transfer with
-- amount 960 and destination_amount 1000 between two accounts in the same
-- currency. The accounts gain 40 and, until now, no budget owned it, so it sat
-- in "Nicht zugeordnet" (envelope_reconciliation counts destination_amount -
-- amount of every transfer there).
--
-- 1. transactions.difference_category_id names the budget the difference goes
--    to. A trigger keeps exactly one linked reallocation in step with the
--    transfer: from "Nicht zugeordnet" to that budget, for the difference, on
--    the transfer's date, with its description as the note. Changing the
--    transfer moves it; a smaller or equal received amount, another currency,
--    no budget, or another type removes it; deleting the transfer deletes it
--    (transaction_id ON DELETE CASCADE). Non-transfers never keep the column.
--
-- 2. category_ledger returns the transfer on such a reallocation row, so the
--    Verlauf can open the transfer instead of an edit sheet.
--
-- 3. validate_transaction_destination_amount allows a received amount in the
--    same currency when it is more than was sent.
--
-- 4. envelope_reconciliation adds unallocated_unswept: leftovers of monthly
--    envelopes with no sweep target anywhere. They used to drop out of every
--    budget and open a gap in the check; now they show as unassigned money.

-- A received amount on a same-currency transfer was refused outright. It is
-- allowed now when more arrives than was paid (the discount); receiving less
-- is still refused, because that difference is a fee and has its own field.
CREATE OR REPLACE FUNCTION public.validate_transaction_destination_amount()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src_cur text;
  v_dst_cur text;
BEGIN
  IF NEW.destination_amount IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.destination_amount <= 0 THEN
    RAISE EXCEPTION 'destination_amount must be greater than zero';
  END IF;

  IF NEW.type <> 'transfer' THEN
    RAISE EXCEPTION 'destination_amount is only allowed on transfers';
  END IF;

  IF NEW.destination_account_id IS NULL THEN
    RAISE EXCEPTION 'destination_amount requires a destination account';
  END IF;

  SELECT currency_code INTO v_src_cur FROM public.accounts WHERE id = NEW.source_account_id;
  SELECT currency_code INTO v_dst_cur FROM public.accounts WHERE id = NEW.destination_account_id;

  IF v_src_cur IS NOT DISTINCT FROM v_dst_cur AND NEW.destination_amount <= NEW.amount THEN
    RAISE EXCEPTION 'in the same currency, destination_amount must be more than the amount sent (record a smaller amount received as a fee)';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS difference_category_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.clear_non_transfer_difference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type IS DISTINCT FROM 'transfer' THEN
    NEW.difference_category_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_non_transfer_difference ON public.transactions;
CREATE TRIGGER trg_clear_non_transfer_difference
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.clear_non_transfer_difference();

-- SECURITY DEFINER so a transfer saved by a server function (service role) or
-- the browser gets the same row; every value comes from the transfer itself,
-- and validate_category_reallocation still checks the budget belongs to the
-- same user and rolls over.
CREATE OR REPLACE FUNCTION public.sync_transfer_difference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_same_currency boolean := false;
  v_diff numeric := 0;
BEGIN
  IF NEW.type = 'transfer' AND NEW.difference_category_id IS NOT NULL
     AND NEW.destination_amount IS NOT NULL THEN
    SELECT s.currency_code IS NOT DISTINCT FROM d.currency_code
      INTO v_same_currency
      FROM public.accounts s, public.accounts d
     WHERE s.id = NEW.source_account_id AND d.id = NEW.destination_account_id;
    v_diff := NEW.destination_amount - NEW.amount;
  END IF;

  IF COALESCE(v_same_currency, false) AND v_diff > 0 THEN
    INSERT INTO public.category_reallocations
      (user_id, from_category_id, to_category_id, amount, occurred_on, note, transaction_id)
    VALUES
      (NEW.user_id, NULL, NEW.difference_category_id, v_diff, NEW.occurred_on, NEW.description, NEW.id)
    ON CONFLICT (transaction_id) DO UPDATE
      SET from_category_id = NULL,
          to_category_id = EXCLUDED.to_category_id,
          amount = EXCLUDED.amount,
          occurred_on = EXCLUDED.occurred_on,
          note = EXCLUDED.note;
  ELSE
    DELETE FROM public.category_reallocations WHERE transaction_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_transfer_difference ON public.transactions;
CREATE TRIGGER trg_sync_transfer_difference
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_transfer_difference();

CREATE OR REPLACE FUNCTION public.category_ledger(p_category_id uuid, p_from date, p_to date)
RETURNS TABLE(
  entry_key text,
  occurred_on date,
  kind text,
  amount numeric,
  running_balance numeric,
  transaction_id uuid,
  reallocation_id uuid,
  counterpart_category_id uuid,
  account_id uuid,
  description text,
  meta jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cat public.categories%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO v_cat FROM public.categories c WHERE c.id = p_category_id AND c.user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH default_target AS (
    SELECT s.default_sweep_category_id AS tgt FROM public.settings s WHERE s.user_id = v_uid LIMIT 1
  ),
  -- Non-rolling envelopes and where their leftovers go, as in the balance function.
  sweepers AS (
    SELECT c.id, COALESCE(g.kind, 'expense'::category_group_kind) = 'income' AS is_income,
           COALESCE(c.sweep_target_category_id, g.sweep_target_category_id, (SELECT tgt FROM default_target)) AS target_cid
      FROM public.categories c
      LEFT JOIN public.category_groups g ON g.id = c.group_id
     WHERE c.user_id = v_uid AND c.rolls_over = false
  ),
  relevant_sweepers AS (
    SELECT sw.* FROM sweepers sw
     WHERE (v_cat.rolls_over AND sw.target_cid = p_category_id)
        OR (NOT v_cat.rolls_over AND sw.id = p_category_id)
  ),
  -- Signed expense-minus-income per envelope and month, one pass.
  spent AS (
    SELECT t.category_id, date_trunc('month', t.occurred_on)::date AS month,
           SUM(CASE WHEN t.type = 'expense' THEN t.amount
                    WHEN t.type = 'income' THEN -t.amount ELSE 0 END) AS spent
      FROM public.transactions t
     WHERE t.user_id = v_uid
       AND t.category_id IN (SELECT rs.id FROM relevant_sweepers rs)
     GROUP BY 1, 2
  ),
  sweep_rows AS (
    SELECT cb.category_id AS source_cid, rs.target_cid, cb.month,
           (cb.month + INTERVAL '1 month')::date AS on_date,
           rs.is_income, cb.amount AS allocated,
           CASE WHEN rs.is_income THEN -COALESCE(sp.spent, 0) ELSE COALESCE(sp.spent, 0) END AS actual,
           CASE WHEN rs.is_income THEN (-COALESCE(sp.spent, 0)) - cb.amount
                ELSE cb.amount - COALESCE(sp.spent, 0) END AS variance
      FROM public.category_budgets cb
      JOIN relevant_sweepers rs ON rs.id = cb.category_id
      LEFT JOIN spent sp ON sp.category_id = cb.category_id AND sp.month = cb.month
     WHERE (cb.month + INTERVAL '1 month')::date <= p_to
  ),
  entries AS (
    SELECT 'opening'::text AS e_key, NULL::date AS e_on, 'opening'::text AS e_kind,
           v_cat.opening_balance AS e_amount, 0 AS e_ord, ''::text AS e_tie,
           NULL::uuid AS e_tx, NULL::uuid AS e_re, NULL::uuid AS e_cp, NULL::uuid AS e_acc,
           NULL::text AS e_desc, NULL::jsonb AS e_meta
     WHERE v_cat.rolls_over AND NOT v_cat.is_scope AND COALESCE(v_cat.opening_balance, 0) <> 0

    UNION ALL
    SELECT 'alloc-' || cb.month, cb.month, 'allocation', cb.amount, 2, '',
           NULL, NULL, NULL, NULL, NULL, jsonb_build_object('month', cb.month)
      FROM public.category_budgets cb
     WHERE cb.category_id = p_category_id AND NOT v_cat.is_scope
       AND cb.amount <> 0 AND cb.month <= p_to

    UNION ALL
    SELECT CASE WHEN v_cat.rolls_over THEN 'sweep-' || sr.source_cid || '-' || sr.month
                ELSE 'sweep-out-' || sr.month END,
           sr.on_date,
           CASE WHEN v_cat.rolls_over THEN 'sweep_in' ELSE 'sweep_out' END,
           CASE WHEN v_cat.rolls_over THEN sr.variance ELSE -sr.variance END,
           1, sr.source_cid::text,
           NULL, NULL,
           CASE WHEN v_cat.rolls_over THEN sr.source_cid ELSE sr.target_cid END,
           NULL, NULL,
           jsonb_build_object('month', sr.month, 'allocated', sr.allocated,
                              'actual', sr.actual, 'income', sr.is_income)
      FROM sweep_rows sr
     WHERE sr.variance <> 0
       -- A leftover with nowhere to go stays in its envelope's month; the
       -- balance function drops it too, so only show it leaving when it does.
       AND (v_cat.rolls_over OR sr.target_cid IS NOT NULL)

    UNION ALL
    SELECT 'realloc-' || r.id || CASE WHEN r.to_category_id = p_category_id THEN '-in' ELSE '-out' END,
           r.occurred_on, 'reallocation',
           CASE WHEN r.to_category_id = p_category_id THEN r.amount ELSE -r.amount END,
           3, r.created_at::text || r.id::text,
           r.transaction_id, r.id,
           CASE WHEN r.to_category_id = p_category_id THEN r.from_category_id ELSE r.to_category_id END,
           NULL, r.note, NULL
      FROM public.category_reallocations r
     WHERE r.user_id = v_uid AND r.occurred_on <= p_to
       AND (r.to_category_id = p_category_id OR r.from_category_id = p_category_id)

    UNION ALL
    SELECT 'tx-' || t.id, t.occurred_on, 'transaction',
           CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END,
           4, t.created_at::text || t.id::text,
           t.id, NULL, NULL, t.source_account_id, t.description, NULL
      FROM public.transactions t
     WHERE t.user_id = v_uid AND t.category_id = p_category_id
       AND t.type IN ('income', 'expense') AND t.occurred_on <= p_to
  ),
  ran AS (
    SELECT e.*,
           SUM(e.e_amount) OVER (
             ORDER BY COALESCE(e.e_on, '-infinity'::date), e.e_ord, e.e_tie, e.e_key
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS e_running
      FROM entries e
  )
  SELECT r.e_key, r.e_on, r.e_kind, r.e_amount, r.e_running,
         r.e_tx, r.e_re, r.e_cp, r.e_acc, r.e_desc, r.e_meta
    FROM ran r
   WHERE p_from IS NULL OR (r.e_on IS NOT NULL AND r.e_on >= p_from)
   ORDER BY COALESCE(r.e_on, '-infinity'::date), r.e_ord, r.e_tie, r.e_key;
END;
$function$;

DROP FUNCTION IF EXISTS public.envelope_reconciliation(date);

CREATE OR REPLACE FUNCTION public.envelope_reconciliation(p_as_of date)
 RETURNS TABLE(accounts_total numeric, rollover_total numeric, expense_open numeric, income_open numeric, outstanding_reimbursements numeric, unallocated numeric, residual numeric,
               unallocated_openings numeric, unallocated_uncategorized numeric, unallocated_transfers numeric, unallocated_plan_gap numeric, unallocated_assigned numeric, unallocated_unswept numeric)
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
  v_unswept numeric := 0;
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

  -- Leftovers of monthly envelopes that have nowhere to go: no target on the
  -- envelope, its group or in Settings. category_savings_balance sweeps them
  -- into no envelope, so they are still nobody's money. Same months and the
  -- same allocated-minus-spent as the sweep.
  SELECT COALESCE(SUM(CASE WHEN COALESCE(g.kind, 'expense'::category_group_kind) = 'income'
                           THEN -COALESCE(sp.spent, 0) - cb.amount
                           ELSE cb.amount - COALESCE(sp.spent, 0) END), 0)
    INTO v_unswept
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    LEFT JOIN public.category_groups g ON g.id = c.group_id
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                      WHEN t.type = 'income' THEN -t.amount ELSE 0 END) AS spent
        FROM public.transactions t
       WHERE t.category_id = cb.category_id AND t.user_id = v_uid
         AND t.occurred_on >= cb.month AND t.occurred_on < cb.month + INTERVAL '1 month'
    ) sp ON TRUE
   WHERE c.user_id = v_uid
     AND c.rolls_over = false
     AND cb.month + INTERVAL '1 month' <= p_as_of
     AND COALESCE(c.sweep_target_category_id, g.sweep_target_category_id,
                  (SELECT s.default_sweep_category_id FROM public.settings s WHERE s.user_id = v_uid LIMIT 1)) IS NULL;

  -- Partitioned so outstanding_reimbursements is not counted twice.
  v_unallocated := v_uncat - v_outstanding + v_fx + v_plan_gap + v_unassigned_openings + v_assigned + v_unswept;

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
  unallocated_unswept := v_unswept;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.envelope_reconciliation(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.envelope_reconciliation(date) TO authenticated;
