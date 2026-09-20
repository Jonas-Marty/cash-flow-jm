-- A bill notification captured on the phone (FinReader) proposes the amount
-- and date of a not-yet-posted occurrence of a variable-amount rule. Nothing
-- is posted: the columns only pre-fill the post dialog and tell the user where
-- the numbers came from. They stay on the row after posting, so the phone can
-- still look up what became of its proposal by `proposal_ref`.
ALTER TABLE public.recurring_occurrences
  ADD COLUMN proposed_amount numeric CHECK (proposed_amount > 0),
  ADD COLUMN proposed_occurred_on date,
  ADD COLUMN proposal_source text,
  ADD COLUMN proposal_ref text,
  ADD COLUMN proposal_info text,
  ADD COLUMN proposed_at timestamptz;

-- All or nothing: a half-cleared proposal would pre-fill an amount without
-- being able to say who sent it.
ALTER TABLE public.recurring_occurrences
  ADD CONSTRAINT recurring_occurrences_proposal_complete CHECK (
    (proposed_at IS NULL AND proposed_amount IS NULL AND proposed_occurred_on IS NULL
      AND proposal_source IS NULL AND proposal_ref IS NULL AND proposal_info IS NULL)
    OR
    (proposed_at IS NOT NULL AND proposed_amount IS NOT NULL AND proposed_occurred_on IS NOT NULL
      AND proposal_source IS NOT NULL AND proposal_ref IS NOT NULL)
  );

CREATE INDEX recurring_occurrences_proposal_ref_idx
  ON public.recurring_occurrences (proposal_source, proposal_ref)
  WHERE proposal_ref IS NOT NULL;
