ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS format_locale text NOT NULL DEFAULT 'de';