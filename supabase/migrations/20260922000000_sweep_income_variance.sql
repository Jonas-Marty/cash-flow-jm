-- Close the identity.
--
-- Leftovers from monthly expense envelopes already swept into the sweep target
-- at month end, but income envelopes were excluded, so the difference between
-- the salary you planned for and the salary that arrived reached no envelope at
-- all. It was the last unexplained term in envelope_reconciliation: 371.92.
--
-- With income variance swept, residual is 0.00 at every date -- mid-month too,
-- because an income envelope holds (received - allocated) until the month ends
-- and is then swept like any other.

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
  -- Swept from non-rolling envelopes once a month is fully elapsed. Income
  -- envelopes are included: a bonus or a short month has to reach an envelope
  -- too, otherwise it silently stops being anyone's money.
  per_env_months AS (
    SELECT cb.category_id, cb.month, cb.amount AS allocated,
           COALESCE(g.kind, 'expense'::category_group_kind) = 'income' AS is_income,
           COALESCE(c.sweep_target_category_id, g.sweep_target_category_id, (SELECT tgt FROM default_target)) AS target_cid
      FROM public.category_budgets cb
      JOIN public.categories c ON c.id = cb.category_id
      LEFT JOIN public.category_groups g ON g.id = c.group_id
     WHERE c.user_id = v_uid
       AND c.rolls_over = false
       AND cb.month + INTERVAL '1 month' <= p_as_of
  ),
  per_env_spent AS (
    SELECT pem.category_id, pem.month, pem.allocated, pem.target_cid, pem.is_income,
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
    -- spent is signed expense-minus-income, so an income envelope's variance
    -- is (received - allocated) = (-spent) - allocated.
    SELECT target_cid AS cid,
           SUM(CASE WHEN is_income THEN (-spent) - allocated
                    ELSE allocated - spent END) AS cum
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
