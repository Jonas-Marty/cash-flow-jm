ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_scope boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS funding_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_categories_is_scope ON public.categories(user_id, is_scope) WHERE is_scope = true;