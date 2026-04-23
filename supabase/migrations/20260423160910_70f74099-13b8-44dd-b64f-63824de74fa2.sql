-- 1. category_groups table
CREATE TYPE public.category_group_kind AS ENUM ('income', 'expense', 'savings');

CREATE TABLE public.category_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  name TEXT NOT NULL,
  kind public.category_group_kind NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.category_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.category_groups FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_category_groups_updated_at
BEFORE UPDATE ON public.category_groups
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. categories: add group_id and is_savings
ALTER TABLE public.categories
  ADD COLUMN group_id UUID REFERENCES public.category_groups(id) ON DELETE SET NULL,
  ADD COLUMN is_savings BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_categories_group_id ON public.categories(group_id);

-- 3. category_budgets: per-month budget history
CREATE TABLE public.category_budgets (
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, month),
  CONSTRAINT category_budgets_month_first_day CHECK (EXTRACT(DAY FROM month) = 1)
);

ALTER TABLE public.category_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.category_budgets FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_category_budgets_month ON public.category_budgets(month);

CREATE TRIGGER trg_category_budgets_updated_at
BEFORE UPDATE ON public.category_budgets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. ensure_month_budgets: idempotent copy-forward
CREATE OR REPLACE FUNCTION public.ensure_month_budgets(p_month DATE)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
BEGIN
  INSERT INTO public.category_budgets (category_id, month, amount)
  SELECT
    c.id,
    v_month,
    COALESCE(
      (SELECT cb.amount
         FROM public.category_budgets cb
        WHERE cb.category_id = c.id AND cb.month < v_month
        ORDER BY cb.month DESC
        LIMIT 1),
      c.allocated_budget
    )
  FROM public.categories c
  WHERE c.archived = false
    AND NOT EXISTS (
      SELECT 1 FROM public.category_budgets cb
       WHERE cb.category_id = c.id AND cb.month = v_month
    );
END;
$$;

-- 5. Replace category_month_spending view with a function
DROP VIEW IF EXISTS public.category_month_spending;

CREATE OR REPLACE FUNCTION public.category_month_spending(p_month DATE)
RETURNS TABLE (
  category_id UUID,
  name TEXT,
  group_id UUID,
  group_name TEXT,
  kind public.category_group_kind,
  is_savings BOOLEAN,
  sort_order INTEGER,
  group_sort_order INTEGER,
  allocated NUMERIC,
  spent_or_received NUMERIC,
  variance NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH m AS (
    SELECT date_trunc('month', p_month)::date AS m_start,
           (date_trunc('month', p_month) + INTERVAL '1 month')::date AS m_end
  )
  SELECT
    c.id AS category_id,
    c.name,
    c.group_id,
    g.name AS group_name,
    COALESCE(g.kind, 'expense'::public.category_group_kind) AS kind,
    c.is_savings,
    c.sort_order,
    COALESCE(g.sort_order, 0) AS group_sort_order,
    COALESCE(cb.amount, c.allocated_budget) AS allocated,
    COALESCE((
      SELECT
        CASE
          WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
            SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          ELSE
            SUM(CASE WHEN t.type = 'expense' THEN t.amount
                     WHEN t.type = 'income' THEN -t.amount
                     ELSE 0 END)
        END
      FROM public.transactions t, m
      WHERE t.category_id = c.id
        AND t.occurred_on >= m.m_start
        AND t.occurred_on <  m.m_end
    ), 0) AS spent_or_received,
    CASE
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          FROM public.transactions t, m
          WHERE t.category_id = c.id
            AND t.occurred_on >= m.m_start
            AND t.occurred_on <  m.m_end
        ), 0) - COALESCE(cb.amount, c.allocated_budget)
      ELSE
        COALESCE(cb.amount, c.allocated_budget) - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                          WHEN t.type = 'income' THEN -t.amount
                          ELSE 0 END)
          FROM public.transactions t, m
          WHERE t.category_id = c.id
            AND t.occurred_on >= m.m_start
            AND t.occurred_on <  m.m_end
        ), 0)
    END AS variance
  FROM public.categories c
  LEFT JOIN public.category_groups g ON g.id = c.group_id
  LEFT JOIN public.category_budgets cb
    ON cb.category_id = c.id
   AND cb.month = (SELECT m_start FROM m)
  WHERE c.archived = false
  ORDER BY COALESCE(g.sort_order, 0), g.name NULLS LAST, c.sort_order, c.name;
$$;

-- 6. category_savings_balance view
CREATE OR REPLACE VIEW public.category_savings_balance AS
SELECT
  c.id AS category_id,
  c.name,
  c.group_id,
  COALESCE((SELECT SUM(cb.amount) FROM public.category_budgets cb WHERE cb.category_id = c.id), 0) AS allocated_total,
  COALESCE((
    SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                    WHEN t.type = 'income' THEN -t.amount
                    ELSE 0 END)
    FROM public.transactions t WHERE t.category_id = c.id
  ), 0) AS spent_total,
  COALESCE((SELECT SUM(cb.amount) FROM public.category_budgets cb WHERE cb.category_id = c.id), 0)
    - COALESCE((
      SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                      WHEN t.type = 'income' THEN -t.amount
                      ELSE 0 END)
      FROM public.transactions t WHERE t.category_id = c.id
    ), 0) AS balance
FROM public.categories c
WHERE c.is_savings = true AND c.archived = false;

-- 7. Backfill current-month budgets from existing categories
INSERT INTO public.category_budgets (category_id, month, amount)
SELECT c.id, date_trunc('month', CURRENT_DATE)::date, c.allocated_budget
FROM public.categories c
WHERE c.archived = false
ON CONFLICT (category_id, month) DO NOTHING;