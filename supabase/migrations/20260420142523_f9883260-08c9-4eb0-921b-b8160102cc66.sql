
-- Enums
CREATE TYPE public.account_type AS ENUM ('asset', 'liability');
CREATE TYPE public.transaction_type AS ENUM ('expense', 'income', 'transfer');

-- Updated-at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Accounts
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  name TEXT NOT NULL,
  type public.account_type NOT NULL,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  name TEXT NOT NULL,
  allocated_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_categories_updated BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Transactions
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payee TEXT,
  note TEXT,
  type public.transaction_type NOT NULL,
  source_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  destination_account_id UUID REFERENCES public.accounts(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_needs_destination CHECK (
    (type <> 'transfer') OR (destination_account_id IS NOT NULL AND destination_account_id <> source_account_id)
  ),
  CONSTRAINT transfer_no_category CHECK (type <> 'transfer' OR category_id IS NULL),
  CONSTRAINT non_transfer_no_destination CHECK (type = 'transfer' OR destination_account_id IS NULL)
);
CREATE INDEX idx_tx_occurred_on ON public.transactions(occurred_on DESC);
CREATE INDEX idx_tx_source ON public.transactions(source_account_id);
CREATE INDEX idx_tx_dest ON public.transactions(destination_account_id);
CREATE INDEX idx_tx_category ON public.transactions(category_id);
CREATE INDEX idx_tx_type ON public.transactions(type);
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Transaction tags
CREATE TABLE public.transaction_tags (
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag)
);
CREATE INDEX idx_transaction_tags_tag ON public.transaction_tags(tag);

-- Hashtag extraction trigger
CREATE OR REPLACE FUNCTION public.sync_transaction_tags()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m TEXT;
BEGIN
  DELETE FROM public.transaction_tags WHERE transaction_id = NEW.id;
  IF NEW.note IS NOT NULL THEN
    FOR m IN SELECT DISTINCT lower(substring(x[1] from 2)) FROM regexp_matches(NEW.note, '#([A-Za-z0-9_]+)', 'g') AS x LOOP
      INSERT INTO public.transaction_tags(transaction_id, tag) VALUES (NEW.id, m) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_tx_tags AFTER INSERT OR UPDATE OF note ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_transaction_tags();

-- Settings (single-row config)
CREATE TABLE public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL,
  currency_code TEXT NOT NULL DEFAULT 'CHF',
  currency_symbol TEXT NOT NULL DEFAULT 'CHF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.settings (currency_code, currency_symbol) VALUES ('CHF', 'CHF');

-- View: account balances
CREATE OR REPLACE VIEW public.account_balances AS
SELECT a.id, a.name, a.type, a.archived, a.opening_balance,
  a.opening_balance
    + COALESCE((SELECT SUM(CASE
        WHEN t.type = 'expense' THEN -t.amount
        WHEN t.type = 'income'  THEN  t.amount
        WHEN t.type = 'transfer' THEN -t.amount END)
      FROM public.transactions t WHERE t.source_account_id = a.id), 0)
    + COALESCE((SELECT SUM(t.amount) FROM public.transactions t
       WHERE t.destination_account_id = a.id AND t.type = 'transfer'), 0)
    AS balance
FROM public.accounts a;

-- View: current-month envelope spending
CREATE OR REPLACE VIEW public.category_month_spending AS
SELECT c.id AS category_id, c.name, c.allocated_budget,
  COALESCE(SUM(CASE
    WHEN t.type = 'expense' THEN  t.amount
    WHEN t.type = 'income'  THEN -t.amount
    ELSE 0 END), 0) AS spent
FROM public.categories c
LEFT JOIN public.transactions t
  ON t.category_id = c.id
 AND date_trunc('month', t.occurred_on) = date_trunc('month', CURRENT_DATE)
GROUP BY c.id, c.name, c.allocated_budget;

-- RLS: enable but allow open access for single-user mode
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_all" ON public.accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.transaction_tags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.settings FOR ALL USING (true) WITH CHECK (true);
