-- Scoped categories must not land in the monthly budget arithmetic.
--
-- A scope (categories.is_scope) is a vacation, a camp, a festival: a bucket
-- the user opens on purpose to keep a pile of related spending *out* of the
-- ordinary month. It is funded in one move from its funding envelope when it
-- closes, so counting its plan again inside the month double-counts it.
--
-- Scopes are always created with is_savings = true, so today every one of them
-- adds its allocated_budget to the month's savings target and drags the
-- projected net down by that amount.
--
-- The row keeps being returned -- /add still reads it for the booking-impact
-- preview -- but it now carries is_scope so the callers doing the arithmetic
-- can leave it out.

DROP FUNCTION IF EXISTS public.category_month_spending(date);

CREATE OR REPLACE FUNCTION public.category_month_spending(p_month date)
 RETURNS TABLE(category_id uuid, name text, group_id uuid, group_name text, kind category_group_kind, is_savings boolean, is_scope boolean, sort_order integer, group_sort_order integer, allocated numeric, spent_or_received numeric, variance numeric)
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
    -- effective kind: is_savings wins; otherwise fall back to group kind
    -- (default 'expense' for ungrouped non-savings envelopes).
    CASE
      WHEN c.is_savings THEN 'savings'::public.category_group_kind
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN 'income'::public.category_group_kind
      ELSE 'expense'::public.category_group_kind
    END AS kind,
    c.is_savings,
    COALESCE(c.is_scope, false),
    c.sort_order,
    COALESCE(g.sort_order, 0),
    COALESCE(cb.amount, c.allocated_budget) AS allocated,
    COALESCE((
      SELECT
        CASE
          WHEN c.is_savings THEN 0
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
      WHEN c.is_savings THEN 0
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0) - COALESCE(cb.amount, c.allocated_budget)
      ELSE
        COALESCE(cb.amount, c.allocated_budget) - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                          WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0)
    END AS variance
  FROM public.categories c
  LEFT JOIN public.category_groups g ON g.id = c.group_id
  LEFT JOIN public.category_budgets cb ON cb.category_id = c.id AND cb.month = v_start
  WHERE c.archived = false AND c.user_id = v_uid
  ORDER BY (c.group_id IS NULL), COALESCE(g.sort_order, 0), g.name NULLS LAST, c.sort_order, c.name;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.category_month_spending(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.category_month_spending(date) TO authenticated, service_role;
