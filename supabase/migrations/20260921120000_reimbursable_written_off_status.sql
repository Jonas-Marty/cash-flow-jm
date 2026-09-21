-- A written-off reimbursable is neither "settled" (the money came back) nor
-- "cancelled" (it was never really owed): you gave up on it and charged it to
-- an envelope. Conflating it with either loses that distinction on the
-- dashboard and in reports, and reimbursable_writeoff_category_id already
-- exists for exactly this outcome.

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_reimbursable_status_chk;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_reimbursable_status_chk
  CHECK (
    reimbursable_status IS NULL
    OR reimbursable_status = ANY (ARRAY['open','settled','cancelled','written_off']::text[])
  );

-- Writing off creates no reimbursement link, so nothing would normally trigger
-- a recompute. But a later link change on the same original would, and that
-- would silently reopen an item the user has already resolved.
CREATE OR REPLACE FUNCTION public.recompute_reimbursable_status(p_orig uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_amount numeric;
  v_is_reimb boolean;
  v_status text;
  v_linked numeric;
BEGIN
  SELECT amount, is_reimbursable, reimbursable_status
    INTO v_amount, v_is_reimb, v_status
    FROM public.transactions WHERE id = p_orig;
  IF NOT FOUND OR v_is_reimb IS NOT TRUE THEN
    RETURN;
  END IF;
  -- Don't override an outcome the user chose by hand.
  IF v_status IN ('cancelled', 'written_off') THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_linked
    FROM public.transaction_reimbursements
   WHERE original_transaction_id = p_orig;
  IF v_linked >= v_amount - 0.0049 THEN
    UPDATE public.transactions SET reimbursable_status = 'settled' WHERE id = p_orig;
  ELSE
    UPDATE public.transactions SET reimbursable_status = 'open' WHERE id = p_orig;
  END IF;
END;
$function$;
