-- One month of category_ledger for every envelope, in one call.
--
-- The month list on Budgets shows each envelope's allocation and leftovers next
-- to its transactions. Fetching the ledger per envelope would be one request per
-- card, so this runs category_ledger for all of them and keeps what belongs to
-- the month p_month:
--
--   * everything dated in the month (allocation, leftovers swept in, transfers,
--     transactions), and
--   * a non-rolling envelope's own leftover for the month, which leaves on the
--     first of the next month (meta.month says which month it is from).
--
-- Running balances come from category_ledger, so they agree with the Verlauf.

CREATE OR REPLACE FUNCTION public.category_ledger_month(p_month date)
RETURNS TABLE(
  category_id uuid,
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
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH bounds AS (
    SELECT date_trunc('month', p_month)::date AS m0,
           (date_trunc('month', p_month) + INTERVAL '1 month')::date AS m1
  )
  SELECT c.id, l.entry_key, l.occurred_on, l.kind, l.amount, l.running_balance,
         l.transaction_id, l.reallocation_id, l.counterpart_category_id, l.account_id,
         l.description, l.meta
    FROM public.categories c
    CROSS JOIN bounds b
    CROSS JOIN LATERAL public.category_ledger(c.id, b.m0, b.m1)
      WITH ORDINALITY AS l(entry_key, occurred_on, kind, amount, running_balance,
                           transaction_id, reallocation_id, counterpart_category_id,
                           account_id, description, meta, ord)
   WHERE c.user_id = auth.uid()
     AND (CASE WHEN l.kind = 'sweep_out' THEN (l.meta->>'month')::date = b.m0
               ELSE l.occurred_on < b.m1 END)
   ORDER BY c.id, l.ord;
$function$;

REVOKE ALL ON FUNCTION public.category_ledger_month(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_ledger_month(date) TO authenticated;
