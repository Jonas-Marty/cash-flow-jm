-- Location on pending transactions, so a capture that knows where it happened
-- can carry that through confirmation instead of losing it.
--
-- Mirrors the columns and constraints on public.transactions; confirmation
-- copies them across. No index: the pending list is small and is never queried
-- by location, unlike transactions, which the recent-places picker reads.
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS location_source text;

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_location_source_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('device','manual','search'));

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_location_pair_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_location_pair_check
  CHECK ((latitude IS NULL) = (longitude IS NULL));
