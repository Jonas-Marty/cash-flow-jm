-- An account can only be archived once it is empty.
--
-- Archived accounts drop out of the account total in envelope_reconciliation,
-- but their transactions keep counting for the budgets, so archiving one that
-- still held money opened a gap in the books by exactly its balance. Every
-- real case (closed by the bank, expired gift card, an account no longer
-- tracked) ends with one last booking, so that booking comes first:
--
-- 1. account_balance(id): the balance over all transactions, the way the
--    reconciliation counts it (opening, income, expenses, transfers out at
--    their amount, transfers in at what arrived).
-- 2. A trigger refuses archiving a non-empty account, and changing the opening
--    balance of an archived one. No archived account holds money on dev or prod
--    today, so nothing existing is affected.
-- 3. archive_account() books the remainder and archives in one transaction:
--    to another account in the same currency as a transfer, or into a category
--    as an expense (money left) or income (debt left). It runs as the caller,
--    so row security and every transaction trigger apply as usual.
-- 4. envelope_reconciliation counts every account, archived ones included.
--    It left archived accounts out of the account total and their opening
--    balances out of "Nicht zugeordnet", while their transactions kept
--    counting for the budgets, so even an emptied account opened a gap of its
--    opening balance when archived. An archived account now always holds 0,
--    so including it changes nothing but closes that gap.

CREATE OR REPLACE FUNCTION public.account_balance(p_account_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT a.opening_balance
       + COALESCE((SELECT SUM(CASE WHEN t.type = 'expense' THEN -t.amount
                                   WHEN t.type = 'income' THEN t.amount
                                   WHEN t.type = 'transfer' THEN -t.amount END)
                     FROM public.transactions t WHERE t.source_account_id = a.id), 0)
       + COALESCE((SELECT SUM(COALESCE(t.destination_amount, t.amount))
                     FROM public.transactions t
                    WHERE t.destination_account_id = a.id AND t.type = 'transfer'), 0)
    FROM public.accounts a
   WHERE a.id = p_account_id;
$function$;

REVOKE ALL ON FUNCTION public.account_balance(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.account_balance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_account_archive()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance numeric;
BEGIN
  IF NEW.archived AND NOT COALESCE(OLD.archived, false) THEN
    v_balance := public.account_balance(NEW.id);
    IF abs(COALESCE(v_balance, 0)) >= 0.005 THEN
      RAISE EXCEPTION 'account "%" still holds %: book the remainder out before archiving it', NEW.name, round(v_balance, 2)
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.archived AND OLD.archived AND NEW.opening_balance IS DISTINCT FROM OLD.opening_balance THEN
    RAISE EXCEPTION 'account "%" is archived: unarchive it to change its opening balance', NEW.name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_account_archive ON public.accounts;
CREATE TRIGGER trg_guard_account_archive
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_account_archive();

CREATE OR REPLACE FUNCTION public.archive_account(
  p_account_id uuid,
  p_counter_account_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_on date DEFAULT CURRENT_DATE,
  p_description text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_acc public.accounts%ROWTYPE;
  v_counter public.accounts%ROWTYPE;
  v_balance numeric;
  v_tx uuid := NULL;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_acc FROM public.accounts WHERE id = p_account_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found'; END IF;

  v_balance := round(public.account_balance(p_account_id), 2);

  IF v_balance <> 0 THEN
    IF (p_counter_account_id IS NULL) = (p_category_id IS NULL) THEN
      RAISE EXCEPTION 'choose either an account or a category for the remainder of %', v_balance;
    END IF;

    IF p_counter_account_id IS NOT NULL THEN
      SELECT * INTO v_counter FROM public.accounts
       WHERE id = p_counter_account_id AND user_id = v_uid AND archived = false;
      IF NOT FOUND OR v_counter.id = v_acc.id THEN
        RAISE EXCEPTION 'choose another active account for the remainder';
      END IF;
      IF v_counter.currency_code IS DISTINCT FROM v_acc.currency_code THEN
        RAISE EXCEPTION 'the remainder can only move to an account in %', v_acc.currency_code;
      END IF;
      -- Money left moves out; a debt left is paid from the other account.
      INSERT INTO public.transactions (user_id, type, amount, source_account_id, destination_account_id, occurred_on, description)
      VALUES (v_uid, 'transfer', abs(v_balance),
              CASE WHEN v_balance > 0 THEN v_acc.id ELSE v_counter.id END,
              CASE WHEN v_balance > 0 THEN v_counter.id ELSE v_acc.id END,
              p_on, p_description)
      RETURNING id INTO v_tx;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = p_category_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'category not found';
      END IF;
      -- Money left is spent (lost, expired); a debt left is forgiven (income).
      INSERT INTO public.transactions (user_id, type, amount, source_account_id, category_id, occurred_on, description)
      VALUES (v_uid, CASE WHEN v_balance > 0 THEN 'expense'::transaction_type ELSE 'income'::transaction_type END,
              abs(v_balance), v_acc.id, p_category_id, p_on, p_description)
      RETURNING id INTO v_tx;
    END IF;
  END IF;

  UPDATE public.accounts SET archived = true WHERE id = v_acc.id;
  RETURN v_tx;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_account(uuid, uuid, uuid, date, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_account(uuid, uuid, uuid, date, text) TO authenticated;

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
  WHERE a.user_id = v_uid;

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
                    WHERE a.user_id = v_uid), 0)
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
