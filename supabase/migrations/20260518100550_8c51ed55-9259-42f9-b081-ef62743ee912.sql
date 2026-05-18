-- Add transfer fee fields to transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fee_amount numeric,
  ADD COLUMN IF NOT EXISTS fee_transaction_id uuid,
  ADD COLUMN IF NOT EXISTS fee_category_id uuid;

-- FK: when the fee tx is deleted directly, just unlink it from the transfer
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_fee_transaction_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_fee_transaction_id_fkey
      FOREIGN KEY (fee_transaction_id)
      REFERENCES public.transactions(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_fee_category_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_fee_category_id_fkey
      FOREIGN KEY (fee_category_id)
      REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
END$$;

-- Clear fee fields when row is not a transfer
CREATE OR REPLACE FUNCTION public.clear_non_transfer_fee_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.type <> 'transfer' THEN
    NEW.fee_amount := NULL;
    NEW.fee_transaction_id := NULL;
    NEW.fee_category_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clear_non_transfer_fee_fields ON public.transactions;
CREATE TRIGGER trg_clear_non_transfer_fee_fields
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.clear_non_transfer_fee_fields();

-- When a transfer with a linked fee tx is deleted, also delete the fee tx
CREATE OR REPLACE FUNCTION public.cascade_delete_transfer_fee()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.fee_transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = OLD.fee_transaction_id;
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cascade_delete_transfer_fee ON public.transactions;
CREATE TRIGGER trg_cascade_delete_transfer_fee
AFTER DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_transfer_fee();