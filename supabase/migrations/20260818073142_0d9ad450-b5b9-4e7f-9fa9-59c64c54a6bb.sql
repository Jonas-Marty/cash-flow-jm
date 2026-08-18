ALTER TABLE public.ai_endpoints DROP CONSTRAINT IF EXISTS ai_endpoints_context_level_check;
ALTER TABLE public.ai_endpoints ADD CONSTRAINT ai_endpoints_context_level_check CHECK (context_level = ANY (ARRAY['off'::text,'compact'::text,'full'::text,'xl'::text]));

ALTER TABLE public.statement_import_lines
  ADD COLUMN IF NOT EXISTS suggested_description text,
  ADD COLUMN IF NOT EXISTS suggested_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_tags text[] NOT NULL DEFAULT '{}'::text[];