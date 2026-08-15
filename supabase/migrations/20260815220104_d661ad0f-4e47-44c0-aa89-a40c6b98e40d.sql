REVOKE EXECUTE ON FUNCTION public.prune_audit_logs(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_audit_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prune_audit_logs(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules_for_all_users(date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_recurring_rules(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules(date) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.apply_recurring_rule_backfill(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_recurring_rule_backfill(uuid, text, date) TO authenticated, service_role;