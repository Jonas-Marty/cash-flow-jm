
-- Add write-off metadata to transactions for reimbursables
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reimbursable_writeoff_category_id uuid,
  ADD COLUMN IF NOT EXISTS reimbursable_writeoff_transaction_id uuid;

-- Update trigger function to also clear new write-off fields when is_reimbursable=false
CREATE OR REPLACE FUNCTION public.default_reimbursable_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_reimbursable = true AND NEW.reimbursable_status IS NULL THEN
    NEW.reimbursable_status := 'open';
  END IF;
  IF NEW.is_reimbursable = false THEN
    NEW.reimbursable_status := NULL;
    NEW.reimbursable_counterparty := NULL;
    NEW.reimbursable_reason := NULL;
    NEW.reimbursable_cancel_reason := NULL;
    NEW.reimbursable_writeoff_category_id := NULL;
    NEW.reimbursable_writeoff_transaction_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
