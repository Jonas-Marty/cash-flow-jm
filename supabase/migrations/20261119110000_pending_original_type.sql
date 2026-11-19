-- The /pending snapshot also keeps the type and the transfer target: the card
-- view saves those onto the row as well, so they need an original to compare
-- against and to restore.
CREATE OR REPLACE FUNCTION public.pending_transactions_snapshot_original()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.original IS NULL THEN
    NEW.original := jsonb_build_object(
      'type', NEW.type,
      'amount', NEW.amount,
      'occurred_on', NEW.occurred_on,
      'description', NEW.description,
      'note', NEW.note,
      'category_id', NEW.category_id,
      'source_account_id', NEW.source_account_id,
      'destination_account_id', NEW.destination_account_id,
      'destination_amount', NEW.destination_amount,
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

-- Nothing saved these three onto a pending row before, so the row still holds
-- what arrived.
UPDATE public.pending_transactions
SET original = COALESCE(original, '{}'::jsonb) || jsonb_build_object(
  'type', type,
  'destination_account_id', destination_account_id,
  'destination_amount', destination_amount
)
WHERE original IS NULL OR NOT original ? 'type';
