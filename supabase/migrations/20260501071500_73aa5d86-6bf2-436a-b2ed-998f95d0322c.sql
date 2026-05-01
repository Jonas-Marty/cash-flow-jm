CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  o RECORD;
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

  -- Pass 1: promote already-existing pending occurrences whose effective date
  -- has arrived, when the owning rule is auto-post + fixed-amount. This catches
  -- occurrences that were materialised as pending earlier (e.g. by the 14-month
  -- look-ahead, or before the rule was switched to auto_post).
  FOR o IN
    SELECT occ.id AS occ_id, occ.effective_on, r.*
      FROM public.recurring_occurrences occ
      JOIN public.recurring_rules r ON r.id = occ.rule_id
     WHERE r.user_id = v_uid
       AND r.archived = false
       AND r.auto_post = true
       AND r.is_variable_amount = false
       AND occ.status = 'pending'
       AND occ.effective_on <= p_today
  LOOP
    INSERT INTO public.transactions
      (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
    VALUES
      (v_uid, o.effective_on, o.amount, o.type, o.source_account_id, o.destination_account_id, o.category_id, o.description, o.note, o.id)
    RETURNING id INTO v_tx_id;
    UPDATE public.recurring_occurrences
       SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
     WHERE id = o.occ_id;
  END LOOP;

  -- Pass 2: extend the schedule forward, materialising new occurrences.
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