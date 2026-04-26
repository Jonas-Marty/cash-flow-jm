DROP POLICY IF EXISTS "aci_read" ON storage.objects;

CREATE POLICY "aci_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'account-category-images');