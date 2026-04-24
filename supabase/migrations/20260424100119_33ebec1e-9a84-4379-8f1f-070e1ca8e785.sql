ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'dd.MM.yyyy';