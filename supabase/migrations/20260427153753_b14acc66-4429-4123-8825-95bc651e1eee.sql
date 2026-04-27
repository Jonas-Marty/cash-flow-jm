CREATE OR REPLACE FUNCTION public.recurring_month_step(p_freq public.recurring_frequency)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_freq
    WHEN 'quarterly' THEN 3
    ELSE 1
  END;
$$;

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
  v_step int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT * FROM public.recurring_rules
    WHERE archived = false AND user_id = v_uid
      AND starts_on <= v_pending_horizon
  LOOP
    v_horizon := v_pending_horizon;
    IF r.ends_on IS NOT NULL AND r.ends_on < v_horizon THEN v_horizon := r.ends_on; END IF;
    v_step := public.recurring_month_step(r.frequency);

    SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = r.id;
    IF v_last IS NULL THEN
      v_cursor := date_trunc('month', r.starts_on)::date;
    ELSE
      v_cursor := (date_trunc('month', v_last) + (v_step || ' months')::interval)::date;
    END IF;

    WHILE v_cursor <= v_horizon LOOP
      v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
      IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) AND v_due <= v_horizon THEN
        v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
        IF r.auto_post AND r.is_variable_amount = false AND v_eff <= p_today THEN
          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
          VALUES
            (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id, r.description, r.note, r.id)
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
      v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_recurring_rule_backfill(p_rule_id uuid, p_mode text, p_today date)
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
  v_step int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO r FROM public.recurring_rules
   WHERE id = p_rule_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.starts_on >= p_today THEN RETURN; END IF;

  IF r.is_variable_amount THEN
    v_mode := 'none';
  END IF;

  v_step := public.recurring_month_step(r.frequency);
  v_cursor := date_trunc('month', r.starts_on)::date;
  WHILE v_cursor <= p_today LOOP
    v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
    IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) THEN
      v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
      IF v_eff <= p_today THEN
        IF v_mode = 'post' THEN
          IF NOT EXISTS (SELECT 1 FROM public.recurring_occurrences WHERE rule_id = r.id AND due_on = v_due) THEN
            INSERT INTO public.transactions
              (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
            VALUES
              (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id, r.description, r.note, r.id)
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
    v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_recurring_rule(
  p_day_rule recurring_day_rule,
  p_day_of_month integer,
  p_weekend_adjust weekend_adjust,
  p_starts_on date,
  p_ends_on date,
  p_from date,
  p_to date,
  p_frequency public.recurring_frequency DEFAULT 'monthly'
)
 RETURNS TABLE(due_on date, effective_on date, in_past boolean)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_step int := public.recurring_month_step(p_frequency);
  v_cursor date := date_trunc('month', p_starts_on)::date;
  v_end date := LEAST(p_to, COALESCE(p_ends_on, p_to));
  v_today date := CURRENT_DATE;
  v_due date;
  v_eff date;
BEGIN
  WHILE v_cursor < date_trunc('month', p_from)::date LOOP
    v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
  END LOOP;
  WHILE v_cursor <= v_end LOOP
    v_due := public.compute_due_date(v_cursor, p_day_rule, p_day_of_month);
    IF v_due >= p_starts_on AND (p_ends_on IS NULL OR v_due <= p_ends_on)
       AND v_due >= p_from AND v_due <= p_to THEN
      v_eff := public.compute_effective_date(v_due, p_weekend_adjust);
      due_on := v_due;
      effective_on := v_eff;
      in_past := v_eff < v_today;
      RETURN NEXT;
    END IF;
    v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
  END LOOP;
END;
$function$;