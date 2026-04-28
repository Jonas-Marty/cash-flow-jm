-- 1. Add currency to accounts
ALTER TABLE public.accounts
  ADD COLUMN currency_code text NOT NULL DEFAULT 'CHF',
  ADD COLUMN currency_symbol text NOT NULL DEFAULT 'CHF';

-- Backfill from each user's settings
UPDATE public.accounts a
   SET currency_code = s.currency_code,
       currency_symbol = s.currency_symbol
  FROM public.settings s
 WHERE s.user_id = a.user_id;

-- 2. Add destination_amount to transactions for cross-currency transfers
ALTER TABLE public.transactions
  ADD COLUMN destination_amount numeric;

-- 3. Validation trigger
CREATE OR REPLACE FUNCTION public.validate_transaction_destination_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_src_cur text;
  v_dst_cur text;
BEGIN
  IF NEW.destination_amount IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.destination_amount <= 0 THEN
    RAISE EXCEPTION 'destination_amount must be greater than zero';
  END IF;

  IF NEW.type <> 'transfer' THEN
    RAISE EXCEPTION 'destination_amount is only allowed on transfers';
  END IF;

  IF NEW.destination_account_id IS NULL THEN
    RAISE EXCEPTION 'destination_amount requires a destination account';
  END IF;

  SELECT currency_code INTO v_src_cur FROM public.accounts WHERE id = NEW.source_account_id;
  SELECT currency_code INTO v_dst_cur FROM public.accounts WHERE id = NEW.destination_account_id;

  IF v_src_cur IS NOT DISTINCT FROM v_dst_cur THEN
    RAISE EXCEPTION 'destination_amount is only allowed when source and destination currencies differ';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_destination_amount ON public.transactions;
CREATE TRIGGER trg_validate_destination_amount
BEFORE INSERT OR UPDATE OF destination_amount, type, source_account_id, destination_account_id
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.validate_transaction_destination_amount();

-- 4. Update account_balances view to use destination_amount when present
CREATE OR REPLACE VIEW public.account_balances AS
SELECT
  a.id,
  a.name,
  a.type,
  a.archived,
  a.opening_balance,
  a.opening_balance
  + COALESCE((
      SELECT SUM(
        CASE
          WHEN t.type = 'expense'::transaction_type THEN -t.amount
          WHEN t.type = 'income'::transaction_type THEN t.amount
          WHEN t.type = 'transfer'::transaction_type THEN -t.amount
          ELSE NULL::numeric
        END)
      FROM public.transactions t
      WHERE t.source_account_id = a.id
        AND t.occurred_on <= CURRENT_DATE
    ), 0::numeric)
  + COALESCE((
      SELECT SUM(COALESCE(t.destination_amount, t.amount))
      FROM public.transactions t
      WHERE t.destination_account_id = a.id
        AND t.type = 'transfer'::transaction_type
        AND t.occurred_on <= CURRENT_DATE
    ), 0::numeric) AS balance
FROM public.accounts a;

-- 5. Update account_balances_as_of RPC to use destination_amount
CREATE OR REPLACE FUNCTION public.account_balances_as_of(p_date date)
 RETURNS TABLE(id uuid, name text, type account_type, archived boolean, opening_balance numeric, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.type,
    a.archived,
    a.opening_balance,
    a.opening_balance
      + COALESCE((
          SELECT SUM(
            CASE
              WHEN t.type = 'expense'::transaction_type THEN -t.amount
              WHEN t.type = 'income'::transaction_type THEN t.amount
              WHEN t.type = 'transfer'::transaction_type THEN -t.amount
              ELSE NULL::numeric
            END)
          FROM public.transactions t
          WHERE t.source_account_id = a.id
            AND t.user_id = v_uid
            AND t.occurred_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(COALESCE(t.destination_amount, t.amount))
          FROM public.transactions t
          WHERE t.destination_account_id = a.id
            AND t.user_id = v_uid
            AND t.type = 'transfer'::transaction_type
            AND t.occurred_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(
            CASE
              WHEN r.type = 'expense'::transaction_type THEN -COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0)
              WHEN r.type = 'income'::transaction_type THEN COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0)
              WHEN r.type = 'transfer'::transaction_type THEN -COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0)
              ELSE NULL::numeric
            END)
          FROM public.recurring_occurrences o
          JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.source_account_id = a.id
            AND r.user_id = v_uid
            AND o.status = 'pending'::occurrence_status
            AND o.effective_on <= p_date
        ), 0::numeric)
      + COALESCE((
          SELECT SUM(COALESCE(CASE WHEN r.is_variable_amount THEN r.estimated_amount ELSE r.amount END, 0))
          FROM public.recurring_occurrences o
          JOIN public.recurring_rules r ON r.id = o.rule_id
          WHERE r.destination_account_id = a.id
            AND r.user_id = v_uid
            AND r.type = 'transfer'::transaction_type
            AND o.status = 'pending'::occurrence_status
            AND o.effective_on <= p_date
        ), 0::numeric) AS balance
  FROM public.accounts a
  WHERE a.user_id = v_uid;
END;
$function$;