-- 1) Recreate account_balances view to only count past/today transactions
DROP VIEW IF EXISTS public.account_balances;

CREATE VIEW public.account_balances
WITH (security_invoker = true)
AS
SELECT
  a.id,
  a.name,
  a.type,
  a.archived,
  a.opening_balance,
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
        SELECT SUM(t.amount)
        FROM public.transactions t
        WHERE t.destination_account_id = a.id
          AND t.type = 'transfer'::transaction_type
          AND t.occurred_on <= CURRENT_DATE
      ), 0::numeric) AS balance
FROM public.accounts a;

-- 2) Projection RPC: balances as of a given date, including manually-future-dated
--    transactions and pending recurring occurrences scheduled on/before that date.
CREATE OR REPLACE FUNCTION public.account_balances_as_of(p_date date)
RETURNS TABLE(
  id uuid,
  name text,
  type account_type,
  archived boolean,
  opening_balance numeric,
  balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.type,
    a.archived,
    a.opening_balance,
    a.opening_balance
      -- recorded transactions on or before p_date
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
            AND t.user_id = v_uid
            AND t.occurred_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(t.amount)
          FROM public.transactions t
          WHERE t.destination_account_id = a.id
            AND t.user_id = v_uid
            AND t.type = 'transfer'::transaction_type
            AND t.occurred_on <= p_date
        ), 0::numeric)
      -- pending recurring occurrences scheduled on or before p_date (source side)
      + COALESCE((
          SELECT SUM(
            CASE
              WHEN r.type = 'expense'::transaction_type THEN -r.amount
              WHEN r.type = 'income'::transaction_type THEN r.amount
              WHEN r.type = 'transfer'::transaction_type THEN -r.amount
              ELSE NULL::numeric
            END)
          FROM public.recurring_occurrences o
          JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.source_account_id = a.id
            AND r.user_id = v_uid
            AND o.status = 'pending'::occurrence_status
            AND o.effective_on <= p_date
        ), 0::numeric)
      -- pending recurring transfer occurrences crediting this account
      + COALESCE((
          SELECT SUM(r.amount)
          FROM public.recurring_occurrences o
          JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.destination_account_id = a.id
            AND r.user_id = v_uid
            AND r.type = 'transfer'::transaction_type
            AND o.status = 'pending'::occurrence_status
            AND o.effective_on <= p_date
        ), 0::numeric) AS balance
  FROM public.accounts a
  WHERE a.user_id = v_uid;
END;
$$;