-- Enums
CREATE TYPE public.recurring_frequency AS ENUM ('monthly');
CREATE TYPE public.recurring_day_rule AS ENUM ('fixed_day', 'end_of_month', 'first_of_month');
CREATE TYPE public.weekend_adjust AS ENUM ('none', 'before', 'after');
CREATE TYPE public.occurrence_status AS ENUM ('pending', 'posted', 'skipped');

-- recurring_rules
CREATE TABLE public.recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  type public.transaction_type NOT NULL,
  amount numeric NOT NULL,
  source_account_id uuid NOT NULL,
  destination_account_id uuid,
  category_id uuid,
  payee text,
  note text,
  frequency public.recurring_frequency NOT NULL DEFAULT 'monthly',
  day_rule public.recurring_day_rule NOT NULL DEFAULT 'fixed_day',
  day_of_month int,
  weekend_adjust public.weekend_adjust NOT NULL DEFAULT 'none',
  starts_on date NOT NULL,
  ends_on date,
  auto_post boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.recurring_rules FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_recurring_rules_updated_at
BEFORE UPDATE ON public.recurring_rules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- recurring_occurrences
CREATE TABLE public.recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
  due_on date NOT NULL,
  effective_on date NOT NULL,
  status public.occurrence_status NOT NULL DEFAULT 'pending',
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, due_on)
);

ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.recurring_occurrences FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_rec_occ_rule ON public.recurring_occurrences(rule_id);
CREATE INDEX idx_rec_occ_status ON public.recurring_occurrences(status);
CREATE INDEX idx_rec_occ_tx ON public.recurring_occurrences(transaction_id);

CREATE TRIGGER update_recurring_occurrences_updated_at
BEFORE UPDATE ON public.recurring_occurrences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- compute_effective_date
CREATE OR REPLACE FUNCTION public.compute_effective_date(p_due date, p_adjust public.weekend_adjust)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_dow int;
BEGIN
  IF p_adjust = 'none' THEN
    RETURN p_due;
  END IF;
  v_dow := EXTRACT(ISODOW FROM p_due); -- 1=Mon..7=Sun
  IF p_adjust = 'before' THEN
    IF v_dow = 6 THEN RETURN p_due - 1; -- Sat -> Fri
    ELSIF v_dow = 7 THEN RETURN p_due - 2; -- Sun -> Fri
    END IF;
  ELSIF p_adjust = 'after' THEN
    IF v_dow = 6 THEN RETURN p_due + 2; -- Sat -> Mon
    ELSIF v_dow = 7 THEN RETURN p_due + 1; -- Sun -> Mon
    END IF;
  END IF;
  RETURN p_due;
END;
$$;

-- compute_due_date for a given month start
CREATE OR REPLACE FUNCTION public.compute_due_date(p_month date, p_rule public.recurring_day_rule, p_dom int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', p_month)::date;
  v_last_day date := (date_trunc('month', p_month) + INTERVAL '1 month - 1 day')::date;
  v_day int;
BEGIN
  IF p_rule = 'first_of_month' THEN
    RETURN v_month_start;
  ELSIF p_rule = 'end_of_month' THEN
    RETURN v_last_day;
  ELSE
    v_day := LEAST(COALESCE(p_dom, 1), EXTRACT(DAY FROM v_last_day)::int);
    RETURN (v_month_start + (v_day - 1) * INTERVAL '1 day')::date;
  END IF;
END;
$$;

-- process_recurring_rules
CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
BEGIN
  FOR r IN
    SELECT * FROM public.recurring_rules
    WHERE archived = false
      AND starts_on <= p_today + INTERVAL '7 days'
  LOOP
    -- Horizon: today for auto_post, today+7 for manual
    v_horizon := CASE WHEN r.auto_post THEN p_today ELSE p_today + INTERVAL '7 days' END;
    IF r.ends_on IS NOT NULL AND r.ends_on < v_horizon THEN
      v_horizon := r.ends_on;
    END IF;

    -- Start from the month of the latest existing occurrence, or starts_on
    SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = r.id;
    IF v_last IS NULL THEN
      v_cursor := date_trunc('month', r.starts_on)::date;
    ELSE
      v_cursor := (date_trunc('month', v_last) + INTERVAL '1 month')::date;
    END IF;

    WHILE v_cursor <= v_horizon LOOP
      v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
      -- Skip if outside validity range
      IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) AND v_due <= v_horizon THEN
        v_eff := public.compute_effective_date(v_due, r.weekend_adjust);

        IF r.auto_post AND v_eff <= p_today THEN
          -- Insert transaction then occurrence
          INSERT INTO public.transactions
            (occurred_on, amount, type, source_account_id, destination_account_id,
             category_id, payee, note)
          VALUES
            (v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id,
             r.category_id, r.payee, r.note)
          RETURNING id INTO v_tx_id;

          INSERT INTO public.recurring_occurrences
            (rule_id, due_on, effective_on, status, transaction_id, posted_at)
          VALUES
            (r.id, v_due, v_eff, 'posted', v_tx_id, now())
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        ELSE
          -- Pending (manual, or auto but in the future within lookahead)
          INSERT INTO public.recurring_occurrences
            (rule_id, due_on, effective_on, status)
          VALUES
            (r.id, v_due, v_eff, 'pending')
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        END IF;
      END IF;
      v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;
END;
$$;

-- Trigger: when a transaction backing an occurrence is deleted, flip occurrence back to pending
CREATE OR REPLACE FUNCTION public.reset_occurrence_on_tx_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.recurring_occurrences
     SET status = 'pending',
         transaction_id = NULL,
         posted_at = NULL
   WHERE transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_reset_occurrence_on_tx_delete
BEFORE DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.reset_occurrence_on_tx_delete();