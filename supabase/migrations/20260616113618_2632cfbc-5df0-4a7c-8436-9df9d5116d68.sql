
REVOKE EXECUTE ON FUNCTION public.archive_savings_envelope(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.category_savings_balance_v2(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_audit_logs(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_reimbursable_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconciliation_summary(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_statement_on_comp_delete() FROM PUBLIC;

-- Re-grant to authenticated where appropriate (non-trigger functions)
GRANT EXECUTE ON FUNCTION public.archive_savings_envelope(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.category_savings_balance_v2(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prune_audit_logs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_reimbursable_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliation_summary(date) TO authenticated;
