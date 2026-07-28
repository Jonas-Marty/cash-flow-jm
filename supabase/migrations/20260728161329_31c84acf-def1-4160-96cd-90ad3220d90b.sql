CREATE OR REPLACE FUNCTION public.category_savings_balance_series(p_from date, p_to date)
RETURNS TABLE(category_id uuid, name text, archived boolean, as_of date, cumulative_balance numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.category_savings_balance_series(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.category_savings_balance_series(date, date) TO authenticated;