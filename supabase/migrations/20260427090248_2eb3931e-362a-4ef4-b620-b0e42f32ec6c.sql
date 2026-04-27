-- Add split_group_id to transactions to group multiple slices of one receipt
ALTER TABLE public.transactions
  ADD COLUMN split_group_id uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_split_group_id
  ON public.transactions(split_group_id)
  WHERE split_group_id IS NOT NULL;

-- Validation: all rows in a split group must share user, source account, occurred_on, type, and must NOT be transfers
CREATE OR REPLACE FUNCTION public.validate_transaction_split_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_other RECORD;
BEGIN
  IF NEW.split_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'transfer' THEN
    RAISE EXCEPTION 'transfers cannot be part of a split group';
  END IF;

  SELECT user_id, source_account_id, occurred_on, type
    INTO v_other
    FROM public.transactions
   WHERE split_group_id = NEW.split_group_id
     AND id <> NEW.id
   LIMIT 1;

  IF FOUND THEN
    IF v_other.user_id <> NEW.user_id
       OR v_other.source_account_id <> NEW.source_account_id
       OR v_other.occurred_on <> NEW.occurred_on
       OR v_other.type <> NEW.type THEN
      RAISE EXCEPTION 'split group rows must share user, source_account_id, occurred_on, and type';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_split_group ON public.transactions;
CREATE TRIGGER trg_validate_transaction_split_group
BEFORE INSERT OR UPDATE OF split_group_id, source_account_id, occurred_on, type, user_id
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.validate_transaction_split_group();