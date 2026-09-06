-- Remarks and place on a pending suggestion.
--
-- The pass already proposed a description, a category and tags. It now also
-- proposes the note the user would have written, and the place they were at.
--
-- Place is a whole location, not a name: TxLocation needs coordinates to be
-- storable (see src/lib/location.ts), and only the user's own past
-- transactions can supply those. The model is therefore never asked for a
-- place -- it could only guess a label, which nothing could apply.
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS suggested_note text,
  ADD COLUMN IF NOT EXISTS suggested_location jsonb;

COMMENT ON COLUMN public.pending_transactions.suggested_note IS
  'Proposed note. NULL = nothing worth proposing.';
COMMENT ON COLUMN public.pending_transactions.suggested_location IS
  'Proposed location as a TxLocation object (latitude, longitude, accuracy_m, label, source). History-sourced only.';
