CREATE TABLE public.statement_imports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT '',
  period_from date,
  period_to date,
  closing_balance numeric,
  currency_code text,
  status text NOT NULL DEFAULT 'extracted',
  model text,
  match_window_days smallint NOT NULL DEFAULT 3,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_imports TO authenticated;
GRANT ALL ON public.statement_imports TO service_role;
ALTER TABLE public.statement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own statement imports" ON public.statement_imports
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX statement_imports_user_created_idx ON public.statement_imports (user_id, created_at DESC);

CREATE TRIGGER update_statement_imports_updated_at
  BEFORE UPDATE ON public.statement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.statement_import_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES public.statement_imports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  line_no integer NOT NULL DEFAULT 0,
  booking_date date,
  value_date date,
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL,
  raw_text text,
  match_status text NOT NULL DEFAULT 'unmatched',
  matched_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  match_score numeric,
  decision text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statement_import_lines TO authenticated;
GRANT ALL ON public.statement_import_lines TO service_role;
ALTER TABLE public.statement_import_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own statement import lines" ON public.statement_import_lines
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX statement_import_lines_import_idx ON public.statement_import_lines (import_id, line_no);

CREATE TRIGGER update_statement_import_lines_updated_at
  BEFORE UPDATE ON public.statement_import_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();