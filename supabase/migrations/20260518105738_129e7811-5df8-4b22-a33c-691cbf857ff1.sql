
CREATE TABLE public.account_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL,
  as_of date NOT NULL,
  statement_balance numeric NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  external_ref text,
  note text,
  status text NOT NULL DEFAULT 'open',
  compensation_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_statements_status_chk CHECK (status IN ('open','matched','compensated')),
  CONSTRAINT account_statements_uniq UNIQUE (account_id, as_of, source)
);

CREATE INDEX account_statements_user_acc_date_idx
  ON public.account_statements (user_id, account_id, as_of DESC);

ALTER TABLE public.account_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own account_statements"
  ON public.account_statements
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_account_statements_updated_at
  BEFORE UPDATE ON public.account_statements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- When the linked compensation transaction is deleted, reopen the statement.
CREATE OR REPLACE FUNCTION public.reopen_statement_on_comp_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.account_statements
     SET status = 'open',
         compensation_transaction_id = NULL,
         updated_at = now()
   WHERE compensation_transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_reopen_statement_on_comp_delete
  BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.reopen_statement_on_comp_delete();
