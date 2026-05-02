-- 1. Columns on transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reimbursable_status text,
  ADD COLUMN IF NOT EXISTS reimbursable_counterparty text,
  ADD COLUMN IF NOT EXISTS reimbursable_reason text,
  ADD COLUMN IF NOT EXISTS reimbursable_cancel_reason text;

-- Status check
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_reimbursable_status_chk;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_reimbursable_status_chk
  CHECK (reimbursable_status IS NULL OR reimbursable_status IN ('open','settled','cancelled'));

-- Default status to 'open' on insert when flagged
CREATE OR REPLACE FUNCTION public.default_reimbursable_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_reimbursable = true AND NEW.reimbursable_status IS NULL THEN
    NEW.reimbursable_status := 'open';
  END IF;
  IF NEW.is_reimbursable = false THEN
    NEW.reimbursable_status := NULL;
    NEW.reimbursable_counterparty := NULL;
    NEW.reimbursable_reason := NULL;
    NEW.reimbursable_cancel_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_reimbursable_status ON public.transactions;
CREATE TRIGGER trg_default_reimbursable_status
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.default_reimbursable_status();

CREATE INDEX IF NOT EXISTS idx_tx_reimbursable_open
  ON public.transactions(user_id, reimbursable_status)
  WHERE is_reimbursable = true AND reimbursable_status = 'open';

-- 2. Link table
CREATE TABLE IF NOT EXISTS public.transaction_reimbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  original_transaction_id uuid NOT NULL,
  settling_transaction_id uuid NOT NULL,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (original_transaction_id, settling_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_treimb_orig ON public.transaction_reimbursements(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_treimb_sett ON public.transaction_reimbursements(settling_transaction_id);

ALTER TABLE public.transaction_reimbursements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own transaction_reimbursements" ON public.transaction_reimbursements;
CREATE POLICY "own transaction_reimbursements"
ON public.transaction_reimbursements
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- 3. Validate link rows + recompute original status
CREATE OR REPLACE FUNCTION public.validate_reimbursement_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_orig_user uuid;
  v_sett_user uuid;
  v_orig_is_reimb boolean;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'reimbursement link amount must be greater than zero';
  END IF;
  IF NEW.original_transaction_id = NEW.settling_transaction_id THEN
    RAISE EXCEPTION 'a transaction cannot reimburse itself';
  END IF;
  SELECT user_id, is_reimbursable INTO v_orig_user, v_orig_is_reimb
    FROM public.transactions WHERE id = NEW.original_transaction_id;
  SELECT user_id INTO v_sett_user
    FROM public.transactions WHERE id = NEW.settling_transaction_id;
  IF v_orig_user IS NULL OR v_sett_user IS NULL THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;
  IF v_orig_user <> NEW.user_id OR v_sett_user <> NEW.user_id THEN
    RAISE EXCEPTION 'reimbursement link transactions must belong to the same user';
  END IF;
  IF v_orig_is_reimb IS NOT TRUE THEN
    RAISE EXCEPTION 'original transaction must be flagged as reimbursable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_reimbursement_link ON public.transaction_reimbursements;
CREATE TRIGGER trg_validate_reimbursement_link
BEFORE INSERT OR UPDATE ON public.transaction_reimbursements
FOR EACH ROW EXECUTE FUNCTION public.validate_reimbursement_link();

CREATE OR REPLACE FUNCTION public.recompute_reimbursable_status(p_orig uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Don't override a manually cancelled status.
  IF v_status = 'cancelled' THEN
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
$$;

CREATE OR REPLACE FUNCTION public.after_reimbursement_link_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_reimbursable_status(OLD.original_transaction_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_reimbursable_status(NEW.original_transaction_id);
    IF TG_OP = 'UPDATE' AND OLD.original_transaction_id <> NEW.original_transaction_id THEN
      PERFORM public.recompute_reimbursable_status(OLD.original_transaction_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_reimbursement_link_change ON public.transaction_reimbursements;
CREATE TRIGGER trg_after_reimbursement_link_change
AFTER INSERT OR UPDATE OR DELETE ON public.transaction_reimbursements
FOR EACH ROW EXECUTE FUNCTION public.after_reimbursement_link_change();

-- Cascade: when a transaction is deleted, remove its link rows (PG handles via FK if we add).
-- We skip FKs (project pattern) but cascade explicitly via trigger.
CREATE OR REPLACE FUNCTION public.cascade_delete_reimbursement_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r uuid;
BEGIN
  -- Recompute originals affected by deleting this as a settler:
  FOR r IN SELECT original_transaction_id FROM public.transaction_reimbursements
            WHERE settling_transaction_id = OLD.id LOOP
    DELETE FROM public.transaction_reimbursements WHERE settling_transaction_id = OLD.id AND original_transaction_id = r;
    PERFORM public.recompute_reimbursable_status(r);
  END LOOP;
  -- Delete any links where this is the original (no need to recompute, original is gone).
  DELETE FROM public.transaction_reimbursements WHERE original_transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_delete_reimbursement_links ON public.transactions;
CREATE TRIGGER trg_cascade_delete_reimbursement_links
BEFORE DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_reimbursement_links();

-- When original amount changes, recompute status
CREATE OR REPLACE FUNCTION public.tx_amount_change_recompute_reimb()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_reimbursable = true AND NEW.amount <> OLD.amount THEN
    PERFORM public.recompute_reimbursable_status(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_amount_change_recompute_reimb ON public.transactions;
CREATE TRIGGER trg_tx_amount_change_recompute_reimb
AFTER UPDATE OF amount ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.tx_amount_change_recompute_reimb();