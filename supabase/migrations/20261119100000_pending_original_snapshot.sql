-- Pending rows keep what arrived.
--
-- Edits made on /pending are now saved onto the pending row itself as they
-- are typed, so the row no longer shows what the phone or the import sent.
-- `original` is that first state, written once on insert and never touched by
-- the app again (the phone API moves only its place fields when a better fix
-- arrives for a row whose place nobody has changed). /pending compares the row
-- against it to show what was changed and to put it back.
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS original jsonb;

CREATE OR REPLACE FUNCTION public.pending_transactions_snapshot_original()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.original IS NULL THEN
    NEW.original := jsonb_build_object(
      'amount', NEW.amount,
      'occurred_on', NEW.occurred_on,
      'description', NEW.description,
      'note', NEW.note,
      'category_id', NEW.category_id,
      'source_account_id', NEW.source_account_id,
      'latitude', NEW.latitude,
      'longitude', NEW.longitude,
      'location_accuracy_m', NEW.location_accuracy_m,
      'location_label', NEW.location_label,
      'location_source', NEW.location_source
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pending_transactions_snapshot_original ON public.pending_transactions;
CREATE TRIGGER pending_transactions_snapshot_original
  BEFORE INSERT ON public.pending_transactions
  FOR EACH ROW EXECUTE FUNCTION public.pending_transactions_snapshot_original();

-- Until now no edit was ever saved onto a pending row, so what every row holds
-- today is still what arrived.
UPDATE public.pending_transactions
SET original = jsonb_build_object(
  'amount', amount,
  'occurred_on', occurred_on,
  'description', description,
  'note', note,
  'category_id', category_id,
  'source_account_id', source_account_id,
  'latitude', latitude,
  'longitude', longitude,
  'location_accuracy_m', location_accuracy_m,
  'location_label', location_label,
  'location_source', location_source
)
WHERE original IS NULL;

-- The automatic suggestion pass now looks at every row it has not looked at,
-- categorised or not: it proposes description, note, tags and place as well.
DROP INDEX IF EXISTS public.pending_transactions_unsuggested_idx;
CREATE INDEX IF NOT EXISTS pending_transactions_unsuggested_idx
  ON public.pending_transactions (user_id, created_at DESC)
  WHERE status = 'pending' AND suggested_at IS NULL;
