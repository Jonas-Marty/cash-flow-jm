
CREATE TYPE public.pending_transaction_status AS ENUM ('pending', 'confirmed', 'rejected');

CREATE TABLE public.pending_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  status public.pending_transaction_status NOT NULL DEFAULT 'pending',

  source_account_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),

  type public.transaction_type NOT NULL DEFAULT 'expense',
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  destination_account_id uuid,
  category_id uuid,
  description text,
  note text,
  destination_amount numeric,

  external_source text,
  external_ref text,
  external_info text,

  confirmed_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pending_transactions_external_dedupe
  ON public.pending_transactions (user_id, external_source, external_ref)
  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;

CREATE INDEX pending_transactions_user_status_idx
  ON public.pending_transactions (user_id, status, created_at DESC);

ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own pending_transactions"
  ON public.pending_transactions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Validate ownership of referenced rows
CREATE OR REPLACE FUNCTION public.validate_pending_transaction_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.accounts WHERE id = NEW.source_account_id;
  IF v_owner IS NULL OR v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'source_account_id does not belong to user';
  END IF;
  IF NEW.destination_account_id IS NOT NULL THEN
    SELECT user_id INTO v_owner FROM public.accounts WHERE id = NEW.destination_account_id;
    IF v_owner IS NULL OR v_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'destination_account_id does not belong to user';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    SELECT user_id INTO v_owner FROM public.categories WHERE id = NEW.category_id;
    IF v_owner IS NULL OR v_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'category_id does not belong to user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pending_transactions_validate_refs
  BEFORE INSERT OR UPDATE ON public.pending_transactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_pending_transaction_refs();

CREATE TRIGGER pending_transactions_set_updated_at
  BEFORE UPDATE ON public.pending_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER pending_transactions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.pending_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
