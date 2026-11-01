-- Save several budgets of one month together.
--
-- The month editor on Budgets changes any number of budgets at once. Saving them
-- one call at a time could leave half of them saved when one fails, so this
-- applies them in one transaction. Each goes through set_category_budget, so
-- "forward" keeps its meaning (later stored months and the template follow) and a
-- change to a closed month is still recorded in the audit log.
--
-- p_amounts: [{"category_id": "...", "amount": 250}, ...]

CREATE OR REPLACE FUNCTION public.set_month_budgets(
  p_month   date,
  p_scope   text,
  p_amounts jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  IF jsonb_typeof(COALESCE(p_amounts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'amounts must be a list';
  END IF;

  FOR r IN
    SELECT x.category_id, x.amount
      FROM jsonb_to_recordset(COALESCE(p_amounts, '[]'::jsonb)) AS x(category_id uuid, amount numeric)
  LOOP
    IF r.category_id IS NULL OR r.amount IS NULL THEN
      RAISE EXCEPTION 'every entry needs a budget and an amount';
    END IF;
    PERFORM public.set_category_budget(r.category_id, p_month, round(r.amount, 2), p_scope);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_month_budgets(date, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_month_budgets(date, text, jsonb) TO authenticated;
