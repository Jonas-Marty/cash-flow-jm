-- Storage: require auth for write/update/delete on account-category-images
DROP POLICY IF EXISTS "aci_insert" ON storage.objects;
DROP POLICY IF EXISTS "aci_update" ON storage.objects;
DROP POLICY IF EXISTS "aci_delete" ON storage.objects;

CREATE POLICY "aci_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'account-category-images');

CREATE POLICY "aci_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'account-category-images')
  WITH CHECK (bucket_id = 'account-category-images');

CREATE POLICY "aci_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'account-category-images');

-- auth_providers: restrict read to authenticated users (was public)
DROP POLICY IF EXISTS "everyone reads enabled providers" ON public.auth_providers;

CREATE POLICY "authenticated read enabled providers"
  ON public.auth_providers
  FOR SELECT
  TO authenticated
  USING (enabled = true OR public.has_role(auth.uid(), 'admin'::public.app_role));