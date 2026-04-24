
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS emoji text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_order integer;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS emoji text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_order integer;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'account-category-images',
  'account-category-images',
  true,
  5242880,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "aci_read" ON storage.objects;
DROP POLICY IF EXISTS "aci_insert" ON storage.objects;
DROP POLICY IF EXISTS "aci_update" ON storage.objects;
DROP POLICY IF EXISTS "aci_delete" ON storage.objects;

CREATE POLICY "aci_read" ON storage.objects FOR SELECT USING (bucket_id = 'account-category-images');
CREATE POLICY "aci_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'account-category-images');
CREATE POLICY "aci_update" ON storage.objects FOR UPDATE USING (bucket_id = 'account-category-images');
CREATE POLICY "aci_delete" ON storage.objects FOR DELETE USING (bucket_id = 'account-category-images');
