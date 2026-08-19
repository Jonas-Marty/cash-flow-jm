ALTER TABLE public.statement_imports
  ADD COLUMN IF NOT EXISTS file_source text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS file_type text;

ALTER TABLE public.statement_imports
  DROP CONSTRAINT IF EXISTS statement_imports_file_source_check;
ALTER TABLE public.statement_imports
  ADD CONSTRAINT statement_imports_file_source_check
  CHECK (file_source IN ('none', 'internal', 'nextcloud', 'external'));

DROP POLICY IF EXISTS "statement files owner select" ON storage.objects;
CREATE POLICY "statement files owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'statement-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "statement files owner insert" ON storage.objects;
CREATE POLICY "statement files owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'statement-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "statement files owner update" ON storage.objects;
CREATE POLICY "statement files owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'statement-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'statement-files' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "statement files owner delete" ON storage.objects;
CREATE POLICY "statement files owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'statement-files' AND (storage.foldername(name))[1] = auth.uid()::text);