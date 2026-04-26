ALTER TABLE public.transactions RENAME COLUMN payee TO description;
ALTER TABLE public.recurring_rules RENAME COLUMN payee TO description;

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
      v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;
END;
$function$;

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
    v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
  END LOOP;
END;
$function$;