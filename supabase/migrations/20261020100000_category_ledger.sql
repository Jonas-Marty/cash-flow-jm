-- Every movement of one envelope, with the balance after each.
--
-- The Verlauf sheet listed transactions and reallocations only and counted its
-- running balance backwards from today. The monthly allocation, the swept
-- leftovers and the opening balance were not entries, so every row older than
-- the current month showed a balance off by at least one month's allocation.
--
-- category_ledger returns each term that category_savings_balance adds up, one
-- row per event, dated on the day the balance function starts counting it:
--
--   opening      categories.opening_balance (no date; first in the running sum)
--   allocation   category_budgets, on the first of its month (not for scopes)
--   sweep_in     another envelope's leftover, on the first of the next month,
--                one row per source and month; meta says how it came about
--   sweep_out    this envelope's own leftover leaving it (non-rolling only)
--   reallocation category_reallocations in (+) or out (-)
--   transaction  income (+) / expense (-) booked on the category
--
-- For a rolling envelope, the running_balance of the last row on or before D
-- equals category_savings_balance(D).cumulative_balance. Amounts are nominal,
-- exactly as in the balance function.
--
-- p_from NULL means the whole history, opening row included. Rows come back in
-- booking order, oldest first.

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
           NULL, r.id,
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

REVOKE ALL ON FUNCTION public.category_ledger(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_ledger(uuid, date, date) TO authenticated;
