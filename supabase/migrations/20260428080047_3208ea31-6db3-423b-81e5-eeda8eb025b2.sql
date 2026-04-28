-- 1) Make account_balances view enforce caller's RLS
ALTER VIEW public.account_balances SET (security_invoker = true);

-- 2) Lock down SECURITY DEFINER functions: revoke from PUBLIC and anon
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.account_balances_as_of(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.category_month_spending(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_recurring_rule(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ensure_month_budgets(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_recurring_rule_backfill(uuid, text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.process_recurring_rules(date) FROM PUBLIC, anon;

-- Ensure authenticated users can still call user-facing RPCs
GRANT EXECUTE ON FUNCTION public.account_balances_as_of(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.category_month_spending(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_recurring_rule(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_month_budgets(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_recurring_rule_backfill(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules(date) TO authenticated;