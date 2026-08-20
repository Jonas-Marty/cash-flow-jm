ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS location_source text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_location_source_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('device','manual','search'));

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_location_pair_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_location_pair_check
  CHECK ((latitude IS NULL) = (longitude IS NULL));

CREATE INDEX IF NOT EXISTS transactions_location_idx
  ON public.transactions (user_id, occurred_on DESC)
  WHERE latitude IS NOT NULL;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS capture_location boolean NOT NULL DEFAULT false;