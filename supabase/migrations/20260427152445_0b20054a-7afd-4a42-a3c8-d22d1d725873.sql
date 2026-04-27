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
    AND c.is_savings = false
    AND NOT EXISTS (
      SELECT 1 FROM public.category_budgets cb
       WHERE cb.category_id = c.id AND cb.month = v_month);
END;
$function$;