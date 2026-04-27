CREATE OR REPLACE FUNCTION public.recurring_month_step(p_freq recurring_frequency)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_freq
    WHEN 'quarterly' THEN 3
    WHEN 'yearly' THEN 12
    ELSE 1
  END;
$function$;