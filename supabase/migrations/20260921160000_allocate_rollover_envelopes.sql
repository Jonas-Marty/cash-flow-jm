-- Rolling-over envelopes were never allocated anything.
--
-- ensure_month_budgets filtered them out, a trigger deleted whatever budget
-- rows they already had the moment the flag was switched on, and
-- category_savings_balance_v2 only ever turned *non*-rolling envelopes'
-- leftovers into envelope money. So allocated_budget counted towards the
-- monthly plan but never reached the envelope, and every rolling envelope
-- drifted down to minus its own spending: Lebensmittel -946.75 against a
-- 250/month plan, Investment -9181.26, Steuern -3064.15.

-- 1. Stop destroying allocation history when the flag is switched on.
DROP TRIGGER IF EXISTS trg_cleanup_budgets_on_savings_flip ON public.categories;
DROP FUNCTION IF EXISTS public.cleanup_budgets_on_savings_flip();

-- 2. Allocate every envelope except scopes, which are funded in one move from
--    their funding envelope when they close and never join the monthly plan.
CREATE OR REPLACE FUNCTION public.ensure_month_budgets(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.category_budgets (category_id, month, amount)
  SELECT c.id, v_month,
    COALESCE(
      (SELECT cb.amount FROM public.category_budgets cb
        WHERE cb.category_id = c.id AND cb.month < v_month
        ORDER BY cb.month DESC LIMIT 1),
      c.allocated_budget)
  FROM public.categories c
  WHERE c.archived = false AND c.user_id = v_uid
    AND c.is_scope = false
    AND NOT EXISTS (
      SELECT 1 FROM public.category_budgets cb
       WHERE cb.category_id = c.id AND cb.month = v_month);
END;
$function$;

-- 3. Backfill the months that already happened. Seeded from allocated_budget,
--    bounded by each user's earliest existing budget month, and idempotent, so
--    this lands identically on dev and prod with no manual step and a rerun is
--    a no-op.
INSERT INTO public.category_budgets (category_id, month, amount)
SELECT c.id, m.month, c.allocated_budget
  FROM public.categories c
  JOIN LATERAL (
    SELECT generate_series(
             (SELECT MIN(cb.month) FROM public.category_budgets cb
                JOIN public.categories c2 ON c2.id = cb.category_id
               WHERE c2.user_id = c.user_id),
             date_trunc('month', CURRENT_DATE)::date,
             INTERVAL '1 month'
           )::date AS month
  ) m ON TRUE
 WHERE c.rolls_over = true
   AND c.is_scope = false
   AND c.archived = false
ON CONFLICT (category_id, month) DO NOTHING;

-- 4. Credit those allocations to the envelope. from_allocations is a
--    provenance breakdown beside from_sweeps and from_reallocations, not a
--    separate pot: it is the same money.
--
--    The new column changes the return type, so this needs a real drop, and
--    both functions bound to it have to go first and come back unchanged.
DROP FUNCTION IF EXISTS public.category_savings_balance_series(date, date);
DROP FUNCTION IF EXISTS public.reconciliation_summary(date);
DROP FUNCTION IF EXISTS public.category_savings_balance_v2(date);

CREATE OR REPLACE FUNCTION public.category_savings_balance_v2(p_as_of date)
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
    SELECT c.id, c.name, c.archived, c.is_scope
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
    COALESCE(tx.cum, 0) + COALESCE(alloc.cum, 0) + COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) + COALESCE(sweeps.cum, 0) AS cumulative_balance,
    COALESCE(tx.mth, 0) + COALESCE(alloc.mth, 0) + COALESCE(rin.mth, 0) - COALESCE(rout.mth, 0) AS month_activity,
    COALESCE(tx.cum, 0) AS from_transactions,
    COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) AS from_reallocations,
    COALESCE(sweeps.cum, 0) AS from_sweeps,
    COALESCE(alloc.cum, 0) AS from_allocations
  FROM savings s
  LEFT JOIN tx ON tx.category_id = s.id
  LEFT JOIN alloc ON alloc.cid = s.id
  LEFT JOIN rin ON rin.cid = s.id
  LEFT JOIN rout ON rout.cid = s.id
  LEFT JOIN sweeps ON sweeps.cid = s.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.category_savings_balance_v2(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_savings_balance_v2(date) TO authenticated;

-- 5. The two dependants, recreated exactly as they were.
CREATE OR REPLACE FUNCTION public.category_savings_balance_series(p_from date, p_to date)
 RETURNS TABLE(category_id uuid, name text, archived boolean, as_of date, cumulative_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.category_id, b.name, b.archived, d.as_of, b.cumulative_balance
  FROM (
    SELECT LEAST(
             (date_trunc('month', gs) + INTERVAL '1 month - 1 day')::date,
             p_to
           ) AS as_of
    FROM generate_series(
           date_trunc('month', p_from),
           date_trunc('month', p_to),
           INTERVAL '1 month'
         ) AS gs
  ) d
  CROSS JOIN LATERAL public.category_savings_balance_v2(d.as_of) b
  ORDER BY b.name, d.as_of;
$function$

;

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
     AND c.rolls_over = false
     AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
     AND cb.month = v_month_start;

  accounts_total := v_accounts;
  savings_total := v_savings;
  unswept_current_month := v_unswept;
  drift := v_accounts - v_savings - v_unswept;
  RETURN NEXT;
END;
$function$

;

REVOKE ALL ON FUNCTION public.category_savings_balance_series(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_savings_balance_series(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.reconciliation_summary(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconciliation_summary(date) TO authenticated;
