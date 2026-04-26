-- 1. New columns + relax amount NOT NULL
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS is_variable_amount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_amount numeric NULL;

ALTER TABLE public.recurring_rules
  ALTER COLUMN amount DROP NOT NULL;

-- 2. Validation trigger: amount required for fixed rules; auto_post forbidden for variable rules
CREATE OR REPLACE FUNCTION public.validate_recurring_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_variable_amount = false AND NEW.amount IS NULL THEN
    RAISE EXCEPTION 'amount is required for fixed-amount rules';
  END IF;
  IF NEW.is_variable_amount = true AND NEW.auto_post = true THEN
    RAISE EXCEPTION 'variable-amount rules cannot auto-post';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_recurring_rule_trg ON public.recurring_rules;
CREATE TRIGGER validate_recurring_rule_trg
  BEFORE INSERT OR UPDATE ON public.recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_rule();

-- 3. process_recurring_rules: never auto-post variable rules
CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT * FROM public.recurring_rules
    WHERE archived = false AND user_id = v_uid
      AND starts_on <= v_pending_horizon
  LOOP
    v_horizon := v_pending_horizon;
    IF r.ends_on IS NOT NULL AND r.ends_on < v_horizon THEN v_horizon := r.ends_on; END IF;

    SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = r.id;
    IF v_last IS NULL THEN
      v_cursor := date_trunc('month', r.starts_on)::date;
    ELSE
      v_cursor := (date_trunc('month', v_last) + INTERVAL '1 month')::date;
    END IF;

    WHILE v_cursor <= v_horizon LOOP
      v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
      IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) AND v_due <= v_horizon THEN
        v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
        IF r.auto_post AND r.is_variable_amount = false AND v_eff <= p_today THEN
          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, payee, note, recurring_rule_id)
          VALUES
            (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id, r.payee, r.note, r.id)
          RETURNING id INTO v_tx_id;
          INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
          VALUES (r.id, v_due, v_eff, 'posted', v_tx_id, now())
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        ELSE
          INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
          VALUES (r.id, v_due, v_eff, 'pending')
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        END IF;
      END IF;
      v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;
END;
$function$;

-- 4. account_balances_as_of: use estimated_amount for variable rules
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
          SELECT SUM(t.amount)
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

-- 5. apply_recurring_rule_backfill: force 'none' mode for variable rules
CREATE OR REPLACE FUNCTION public.apply_recurring_rule_backfill(
  p_rule_id uuid,
  p_mode text,
  p_today date
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_cursor date;
  v_due date;
  v_eff date;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
  v_mode text := p_mode;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO r FROM public.recurring_rules
   WHERE id = p_rule_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.starts_on >= p_today THEN RETURN; END IF;

  -- variable rules can't post past entries (no amount known)
  IF r.is_variable_amount THEN
    v_mode := 'none';
  END IF;

  v_cursor := date_trunc('month', r.starts_on)::date;
  WHILE v_cursor <= p_today LOOP
    v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
    IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) THEN
      v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
      IF v_eff <= p_today THEN
        IF v_mode = 'post' THEN
          IF NOT EXISTS (SELECT 1 FROM public.recurring_occurrences WHERE rule_id = r.id AND due_on = v_due) THEN
            INSERT INTO public.transactions
              (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, payee, note, recurring_rule_id)
            VALUES
              (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id, r.payee, r.note, r.id)
            RETURNING id INTO v_tx_id;
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
            VALUES (r.id, v_due, v_eff, 'posted', v_tx_id, now())
            ON CONFLICT (rule_id, due_on) DO NOTHING;
          END IF;
        ELSE
          INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
          VALUES (r.id, v_due, v_eff, 'skipped')
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        END IF;
      END IF;
    END IF;
    v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
  END LOOP;
END;
$function$;