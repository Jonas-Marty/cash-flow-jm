-- Rewrite category_month_spending so the per-row behaviour is driven by
-- categories.is_savings first, and only falls back to category_groups.kind
-- when is_savings is false. The returned `kind` column reflects the
-- effective per-row behaviour so the UI no longer needs to recompute it.
CREATE OR REPLACE FUNCTION public.category_month_spending(p_month date)
 RETURNS TABLE(category_id uuid, name text, group_id uuid, group_name text, kind category_group_kind, is_savings boolean, sort_order integer, group_sort_order integer, allocated numeric, spent_or_received numeric, variance numeric)
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

-- Lock down execution to authenticated callers only (matches the rest of the app).
REVOKE EXECUTE ON FUNCTION public.category_month_spending(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.category_month_spending(date) TO authenticated;

-- Trigger: when an envelope is flipped to is_savings = true, drop any monthly
-- budget rows that reference it. Savings envelopes don't use them and stale
-- rows would otherwise drift the UI.
CREATE OR REPLACE FUNCTION public.cleanup_budgets_on_savings_flip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_savings = true AND COALESCE(OLD.is_savings, false) = false THEN
    DELETE FROM public.category_budgets WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_budgets_on_savings_flip ON public.categories;
CREATE TRIGGER trg_cleanup_budgets_on_savings_flip
AFTER UPDATE OF is_savings ON public.categories
FOR EACH ROW
WHEN (NEW.is_savings IS DISTINCT FROM OLD.is_savings)
EXECUTE FUNCTION public.cleanup_budgets_on_savings_flip();