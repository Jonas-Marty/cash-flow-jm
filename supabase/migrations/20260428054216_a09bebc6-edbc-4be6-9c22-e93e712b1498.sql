DROP VIEW IF EXISTS public.account_balances;
CREATE VIEW public.account_balances AS
SELECT
  a.id,
  a.name,
  a.type,
  a.archived,
  a.opening_balance,
  a.currency_code,
  a.currency_symbol,
  a.opening_balance
  + COALESCE((
      SELECT SUM(
        CASE
          WHEN t.type = 'expense'::transaction_type THEN -t.amount
          WHEN t.type = 'income'::transaction_type THEN t.amount
          WHEN t.type = 'transfer'::transaction_type THEN -t.amount
          ELSE NULL::numeric
        END)
      FROM public.transactions t
      WHERE t.source_account_id = a.id
        AND t.occurred_on <= CURRENT_DATE
    ), 0::numeric)
  + COALESCE((
      SELECT SUM(COALESCE(t.destination_amount, t.amount))
      FROM public.transactions t
      WHERE t.destination_account_id = a.id
        AND t.type = 'transfer'::transaction_type
        AND t.occurred_on <= CURRENT_DATE
    ), 0::numeric) AS balance
FROM public.accounts a;

DROP FUNCTION IF EXISTS public.account_balances_as_of(date);
CREATE FUNCTION public.account_balances_as_of(p_date date)
 RETURNS TABLE(id uuid, name text, type account_type, archived boolean, opening_balance numeric, currency_code text, currency_symbol text, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    a.id, a.name, a.type, a.archived, a.opening_balance, a.currency_code, a.currency_symbol,
    a.opening_balance
      + COALESCE((
          SELECT SUM(CASE WHEN t.type = 'expense'::transaction_type THEN -t.amount
                          WHEN t.type = 'income'::transaction_type THEN t.amount
                          WHEN t.type = 'transfer'::transaction_type THEN -t.amount END)
          FROM public.transactions t
          WHERE t.source_account_id = a.id AND t.user_id = v_uid AND t.occurred_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(COALESCE(t.destination_amount, t.amount))
          FROM public.transactions t
          WHERE t.destination_account_id = a.id AND t.user_id = v_uid
            AND t.type = 'transfer'::transaction_type AND t.occurred_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(CASE WHEN r.type = 'expense'::transaction_type THEN -COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0)
                          WHEN r.type = 'income'::transaction_type THEN COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0)
                          WHEN r.type = 'transfer'::transaction_type THEN -COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0) END)
          FROM public.recurring_occurrences o JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.source_account_id = a.id AND r.user_id = v_uid
            AND o.status = 'pending'::occurrence_status AND o.effective_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0))
          FROM public.recurring_occurrences o JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.destination_account_id = a.id AND r.user_id = v_uid
            AND r.type = 'transfer'::transaction_type
            AND o.status = 'pending'::occurrence_status AND o.effective_on <= p_date
        ), 0::numeric) AS balance
  FROM public.accounts a
  WHERE a.user_id = v_uid;
END;
$function$;