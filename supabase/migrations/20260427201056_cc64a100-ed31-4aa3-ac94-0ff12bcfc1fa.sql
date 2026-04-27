
-- 1) auth_providers: keep existing read policies, ensure write policies are admin-only.
-- The existing "admins write providers" policy is FOR ALL with admin USING/CHECK,
-- but PostgreSQL RLS combines permissive policies with OR. Since it's the only
-- write-enabling policy (no other INSERT/UPDATE/DELETE policies exist for non-admins),
-- writes are already admin-only. No-op verification: ensure RLS is enabled.
ALTER TABLE public.auth_providers ENABLE ROW LEVEL SECURITY;

-- Replace existing storage policies on account-category-images with per-user folder ownership.
DROP POLICY IF EXISTS aci_read ON storage.objects;
DROP POLICY IF EXISTS aci_insert ON storage.objects;
DROP POLICY IF EXISTS aci_update ON storage.objects;
DROP POLICY IF EXISTS aci_delete ON storage.objects;

-- Public read remains (icons are rendered via public URL throughout the UI).
CREATE POLICY aci_read_public ON storage.objects
  FOR SELECT
  USING (bucket_id = 'account-category-images');

-- Writes: only inside the user's own top-level folder (<user_id>/...).
CREATE POLICY aci_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'account-category-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY aci_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'account-category-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'account-category-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY aci_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'account-category-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
