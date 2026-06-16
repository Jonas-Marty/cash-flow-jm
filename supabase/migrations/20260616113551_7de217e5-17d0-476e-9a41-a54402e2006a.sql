
-- 1. ai_audit_logs: add INSERT policy scoped to authenticated user
CREATE POLICY "Users insert their own AI audit logs"
ON public.ai_audit_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 2. audit_logs: lock writes. Allow only admins to delete (for prune via SECURITY DEFINER it still works via service role / definer);
--    INSERT/UPDATE remain disallowed for end-users (no permissive policy = denied).
--    Add explicit admin-only policies so the table is clearly system-managed.
CREATE POLICY "Only admins can insert audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Only admins can update audit logs"
ON public.audit_logs
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Only admins can delete audit logs"
ON public.audit_logs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. auth_providers: allow anonymous users to read enabled providers (login screen needs this)
GRANT SELECT ON public.auth_providers TO anon;
CREATE POLICY "Anon can read enabled providers"
ON public.auth_providers
FOR SELECT
TO anon
USING (enabled = true);

-- 4. Revoke EXECUTE from anon on SECURITY DEFINER functions that should not be public
REVOKE EXECUTE ON FUNCTION public.archive_savings_envelope(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.category_savings_balance_v2(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_audit_logs(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_reimbursable_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reconciliation_summary(date) FROM anon;
-- Trigger-only functions (not callable directly via API), revoke just to satisfy linter
REVOKE EXECUTE ON FUNCTION public.audit_row_change() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reopen_statement_on_comp_delete() FROM anon;

-- 5. Pin search_path on remaining functions
ALTER FUNCTION public.format_date_token(date, text, text) SET search_path = public;
ALTER FUNCTION public.interpolate_template(text, date, date, date, date, date, integer, text) SET search_path = public;
ALTER FUNCTION public.interpolate_template(text, date, date, date, date, date, integer, text, date, text, integer) SET search_path = public;
