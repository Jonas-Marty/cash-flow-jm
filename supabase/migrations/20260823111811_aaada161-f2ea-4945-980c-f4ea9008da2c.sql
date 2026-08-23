CREATE OR REPLACE FUNCTION public.reconciliation_summary(p_as_of date)
 RETURNS TABLE(accounts_total numeric, savings_total numeric, unswept_current_month numeric, drift numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + INTERVAL '1 month')::date;
  v_accounts numeric := 0;
  v_savings numeric := 0;
  v_unswept numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

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

  SELECT COALESCE(SUM(cumulative_balance), 0)
    INTO v_savings
    FROM public.category_savings_balance_v2(p_as_of);

  SELECT COALESCE(SUM(cb.amount - COALESCE((
            SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                            WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
            FROM public.transactions t
            WHERE t.category_id = cb.category_id
              AND t.user_id = v_uid
              AND t.occurred_on >= v_month_start
              AND t.occurred_on < v_month_end
         ), 0)), 0)
    INTO v_unswept
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    LEFT JOIN public.category_groups g ON g.id = c.group_id
   WHERE c.user_id = v_uid
     AND c.is_savings = false
     AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
     AND cb.month = v_month_start;

  accounts_total := v_accounts;
  savings_total := v_savings;
  unswept_current_month := v_unswept;
  drift := v_accounts - v_savings - v_unswept;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_savings_envelope(p_id uuid, p_move_remaining_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_balance numeric;
  v_is_savings boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT is_savings INTO v_is_savings FROM public.categories WHERE id = p_id AND user_id = v_uid;
  IF v_is_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'category is not a savings envelope';
  END IF;

  SELECT cumulative_balance INTO v_balance
    FROM public.category_savings_balance_v2(CURRENT_DATE)
   WHERE category_id = p_id;

  IF v_balance IS NULL THEN v_balance := 0; END IF;

  IF v_balance <> 0 THEN
    IF p_move_remaining_to IS NULL THEN
      RAISE EXCEPTION 'a target savings envelope is required to absorb the remaining balance';
    END IF;
    IF v_balance > 0 THEN
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_id, p_move_remaining_to, v_balance, CURRENT_DATE, 'Auto-move on archive');
    ELSE
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_move_remaining_to, p_id, -v_balance, CURRENT_DATE, 'Auto-move on archive (cover deficit)');
    END IF;
  END IF;

  UPDATE public.categories SET archived = true WHERE id = p_id AND user_id = v_uid;
END;
$function$;