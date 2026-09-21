-- Two different things were conflated under "don't materialise months".
--
-- Not materialising the *future* is right: looking at a month is not deciding it, and
-- the budget grid shows twelve at once, so seeding on render would commit a year of
-- copied-forward budgets for anyone who opened it.
--
-- Leaving gaps in the *past* is a bug. A month with no row contributes no allocation
-- and no sweep — `category_savings_balance` sums `cb.month <= p_as_of` for allocations
-- and reads `allocated - spent` per elapsed month for sweeps — so every gap silently
-- understates every rolling envelope's balance and pushes `envelope_reconciliation`'s
-- residual off zero. Away from 22 July until 3 December, the old function seeded only
-- December and left August through November missing.
--
-- So: fill every gap up to the current month, never past it.

CREATE OR REPLACE FUNCTION public.ensure_month_budgets(p_month date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  -- The upper bound is always the current month, whatever was asked for:
  --   * a future p_month must not be materialised;
  --   * a past p_month must still bring the whole gap up to today, because the
  --     backfill cannot depend on which month the user happens to open first.
  -- p_month stays in the signature because callers pass the month they are viewing
  -- and changing it would churn the generated client types for no gain.
  v_target date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  INSERT INTO public.category_budgets (category_id, month, amount)
  SELECT c.id, gs.month::date, prior.amount
    FROM public.categories c
    -- From this envelope's own first budgeted month, so a category created last week
    -- does not acquire a year of history it never had. With none at all, just today.
    CROSS JOIN LATERAL generate_series(
      COALESCE(
        (SELECT min(cb0.month) FROM public.category_budgets cb0 WHERE cb0.category_id = c.id),
        v_target
      ),
      v_target,
      INTERVAL '1 month'
    ) AS gs(month)
    -- Each gap inherits from *its own* nearest prior row, not from the newest one, so
    -- an interior gap is filled with what applied at the time rather than with today's
    -- figure. The subselect reads the pre-statement snapshot, so a run of consecutive
    -- gaps all resolve against the last real row before the run.
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (SELECT cb1.amount
           FROM public.category_budgets cb1
          WHERE cb1.category_id = c.id AND cb1.month <= gs.month::date
          ORDER BY cb1.month DESC
          LIMIT 1),
        c.allocated_budget
      ) AS amount
    ) prior
   WHERE c.user_id = v_uid
     AND c.archived = false
     AND c.is_scope = false
     AND NOT EXISTS (
       SELECT 1 FROM public.category_budgets cb2
        WHERE cb2.category_id = c.id AND cb2.month = gs.month::date
     )
  ON CONFLICT (category_id, month) DO NOTHING;
END;
$function$;


-- A month with no row now only ever means a *future* month. The card view used to
-- fall back to `categories.allocated_budget` for those, while the grid shows what the
-- month would inherit from the month before it — two different numbers for the same
-- cell. The copy-forward rule is the one `ensure_month_budgets` applies, so it is the
-- one both views should show.

CREATE OR REPLACE FUNCTION public.category_month_spending(p_month date)
 RETURNS TABLE(category_id uuid, name text, group_id uuid, group_name text, kind category_group_kind, rolls_over boolean, is_scope boolean, sort_order integer, group_sort_order integer, allocated numeric, spent_or_received numeric, variance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.group_id,
    g.name,
    -- effective kind: rolls_over wins; otherwise fall back to group kind
    -- (default 'expense' for ungrouped non-savings envelopes).
    CASE
      WHEN c.rolls_over THEN 'savings'::public.category_group_kind
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN 'income'::public.category_group_kind
      ELSE 'expense'::public.category_group_kind
    END AS kind,
    c.rolls_over,
    COALESCE(c.is_scope, false),
    c.sort_order,
    COALESCE(g.sort_order, 0),
    b.amount AS allocated,
    COALESCE((
      SELECT
        CASE
          WHEN c.rolls_over THEN 0
          WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
            SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          ELSE
            SUM(CASE WHEN t.type = 'expense' THEN t.amount
                     WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
        END
      FROM public.transactions t
      WHERE t.category_id = c.id AND t.user_id = v_uid
        AND t.occurred_on >= v_start AND t.occurred_on < v_end
    ), 0) AS spent_or_received,
    CASE
      WHEN c.rolls_over THEN 0
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0) - b.amount
      ELSE
        b.amount - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                          WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0)
    END AS variance
  FROM public.categories c
  LEFT JOIN public.category_groups g ON g.id = c.group_id
  -- Exact row for the month, else the nearest prior one, else the template.
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      (SELECT cb.amount
         FROM public.category_budgets cb
        WHERE cb.category_id = c.id AND cb.month <= v_start
        ORDER BY cb.month DESC
        LIMIT 1),
      c.allocated_budget
    ) AS amount
  ) b
  WHERE c.archived = false AND c.user_id = v_uid
  ORDER BY (c.group_id IS NULL), COALESCE(g.sort_order, 0), g.name NULLS LAST, c.sort_order, c.name;
END;
$function$;

REVOKE ALL ON FUNCTION public.category_month_spending(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_month_spending(date) TO authenticated;
