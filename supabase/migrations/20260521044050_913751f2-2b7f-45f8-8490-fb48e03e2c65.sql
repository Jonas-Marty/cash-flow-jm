-- Rewrite process_recurring_rules and process_recurring_rules_for_all_users to
-- support auto-posting of split recurring rules. When r.is_split = true, fan
-- out into N transactions sharing a split_group_id.

CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  o RECORD;
  s RECORD;
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
  v_first_tx_id uuid;
  v_group uuid;
  v_uid uuid := auth.uid();
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
  v_step int;
  v_locale text;
  v_prev date;
  v_next date;
  v_run int;
  v_total numeric;
  v_running numeric;
  v_amt numeric;
  v_slice_count int;
  v_idx int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = v_uid LIMIT 1;
  IF v_locale IS NULL THEN v_locale := 'de'; END IF;

  -- Pass 1: promote pending occurrences whose effective date arrived.
  FOR o IN
    SELECT occ.id AS occ_id, occ.effective_on AS occ_effective_on, occ.due_on AS occ_due_on, rr.*
      FROM public.recurring_occurrences occ
      JOIN public.recurring_rules rr ON rr.id = occ.rule_id
     WHERE rr.user_id = v_uid
       AND rr.archived = false
       AND rr.auto_post = true
       AND rr.is_variable_amount = false
       AND rr.is_variable_date = false
       AND occ.status = 'pending'
       AND occ.effective_on <= p_today
  LOOP
    SELECT MAX(o2.effective_on) INTO v_prev
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = o.id
       AND o2.effective_on < o.occ_effective_on;
    IF v_prev IS NULL THEN v_prev := o.starts_on; END IF;

    SELECT MIN(o2.effective_on) INTO v_next
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = o.id
       AND o2.effective_on > o.occ_effective_on;

    SELECT COUNT(*) INTO v_run
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = o.id
       AND o2.effective_on <= o.occ_effective_on;

    IF o.is_split = true AND o.type <> 'transfer' THEN
      v_group := gen_random_uuid();
      v_total := o.amount;
      v_running := 0;
      v_first_tx_id := NULL;
      SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = o.id;
      v_idx := 0;
      FOR s IN
        SELECT * FROM public.recurring_rule_slices WHERE rule_id = o.id ORDER BY sort_order, id
      LOOP
        v_idx := v_idx + 1;
        IF s.amount_ratio IS NOT NULL THEN
          IF v_idx = v_slice_count THEN
            v_amt := round((v_total - v_running)::numeric, 2);
          ELSE
            v_amt := round((v_total * s.amount_ratio)::numeric, 2);
          END IF;
        ELSE
          v_amt := round(COALESCE(s.amount, 0)::numeric, 2);
        END IF;
        v_running := v_running + v_amt;

        INSERT INTO public.transactions
          (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
           category_id, description, note, recurring_rule_id, split_group_id,
           is_reimbursable, reimbursable_status, reimbursable_counterparty, reimbursable_reason)
        VALUES
          (v_uid, o.occ_effective_on, v_amt, o.type, o.source_account_id, NULL,
           s.category_id,
           public.interpolate_template(s.description, o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
           public.interpolate_template(s.note,        o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
           o.id, v_group,
           s.is_reimbursable,
           CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
           CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
           CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
        RETURNING id INTO v_tx_id;
        IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
      END LOOP;
      UPDATE public.recurring_occurrences
         SET status = 'posted', transaction_id = v_first_tx_id, posted_at = now()
       WHERE id = o.occ_id;
    ELSE
      INSERT INTO public.transactions
        (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
      VALUES
        (v_uid, o.occ_effective_on, o.amount, o.type, o.source_account_id, o.destination_account_id, o.category_id,
         public.interpolate_template(o.description, o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
         public.interpolate_template(o.note,        o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
         o.id)
      RETURNING id INTO v_tx_id;
      UPDATE public.recurring_occurrences
         SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
       WHERE id = o.occ_id;
    END IF;
  END LOOP;

  -- Pass 2: extend schedule forward.
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
        IF r.auto_post
           AND r.is_variable_amount = false
           AND r.is_variable_date = false
           AND v_eff <= p_today THEN
          IF r.is_split = true AND r.type <> 'transfer' THEN
            v_group := gen_random_uuid();
            v_total := r.amount;
            v_running := 0;
            v_first_tx_id := NULL;
            SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = r.id;
            v_idx := 0;
            FOR s IN
              SELECT * FROM public.recurring_rule_slices WHERE rule_id = r.id ORDER BY sort_order, id
            LOOP
              v_idx := v_idx + 1;
              IF s.amount_ratio IS NOT NULL THEN
                IF v_idx = v_slice_count THEN
                  v_amt := round((v_total - v_running)::numeric, 2);
                ELSE
                  v_amt := round((v_total * s.amount_ratio)::numeric, 2);
                END IF;
              ELSE
                v_amt := round(COALESCE(s.amount, 0)::numeric, 2);
              END IF;
              v_running := v_running + v_amt;
              INSERT INTO public.transactions
                (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
                 category_id, description, note, recurring_rule_id, split_group_id,
                 is_reimbursable, reimbursable_status, reimbursable_counterparty, reimbursable_reason)
              VALUES
                (v_uid, v_eff, v_amt, r.type, r.source_account_id, NULL,
                 s.category_id, s.description, s.note, r.id, v_group,
                 s.is_reimbursable,
                 CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
                 CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
                 CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
              RETURNING id INTO v_tx_id;
              IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
            END LOOP;
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
            VALUES (r.id, v_due, v_eff, 'posted', v_first_tx_id, now())
            ON CONFLICT (rule_id, due_on) DO NOTHING;
          ELSE
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
          VALUES (r.id, v_due, v_eff, 'pending')
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        END IF;
      END IF;
      v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_recurring_rules_for_all_users(p_today date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  u RECORD;
  rr RECORD;
  occ RECORD;
  s RECORD;
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
  v_first_tx_id uuid;
  v_group uuid;
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
  v_step int;
  v_count int := 0;
  v_total numeric;
  v_running numeric;
  v_amt numeric;
  v_slice_count int;
  v_idx int;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.recurring_rules WHERE archived = false LOOP
    v_count := v_count + 1;

    FOR occ IN
      SELECT o.id AS occ_id, o.effective_on AS occ_effective_on, r.*
        FROM public.recurring_occurrences o
        JOIN public.recurring_rules r ON r.id = o.rule_id
       WHERE r.user_id = u.user_id
         AND r.archived = false
         AND r.auto_post = true
         AND r.is_variable_amount = false
         AND r.is_variable_date = false
         AND o.status = 'pending'
         AND o.effective_on <= p_today
    LOOP
      IF occ.is_split = true AND occ.type <> 'transfer' THEN
        v_group := gen_random_uuid();
        v_total := occ.amount;
        v_running := 0;
        v_first_tx_id := NULL;
        SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = occ.id;
        v_idx := 0;
        FOR s IN
          SELECT * FROM public.recurring_rule_slices WHERE rule_id = occ.id ORDER BY sort_order, id
        LOOP
          v_idx := v_idx + 1;
          IF s.amount_ratio IS NOT NULL THEN
            IF v_idx = v_slice_count THEN
              v_amt := round((v_total - v_running)::numeric, 2);
            ELSE
              v_amt := round((v_total * s.amount_ratio)::numeric, 2);
            END IF;
          ELSE
            v_amt := round(COALESCE(s.amount, 0)::numeric, 2);
          END IF;
          v_running := v_running + v_amt;
          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
             category_id, description, note, recurring_rule_id, split_group_id,
             is_reimbursable, reimbursable_status, reimbursable_counterparty, reimbursable_reason)
          VALUES
            (u.user_id, occ.occ_effective_on, v_amt, occ.type, occ.source_account_id, NULL,
             s.category_id, s.description, s.note, occ.id, v_group,
             s.is_reimbursable,
             CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
             CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
             CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
          RETURNING id INTO v_tx_id;
          IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
        END LOOP;
        UPDATE public.recurring_occurrences
           SET status = 'posted', transaction_id = v_first_tx_id, posted_at = now()
         WHERE id = occ.occ_id;
      ELSE
        INSERT INTO public.transactions
          (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
        VALUES
          (u.user_id, occ.occ_effective_on, occ.amount, occ.type, occ.source_account_id, occ.destination_account_id, occ.category_id, occ.description, occ.note, occ.id)
        RETURNING id INTO v_tx_id;
        UPDATE public.recurring_occurrences
           SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
         WHERE id = occ.occ_id;
      END IF;
    END LOOP;

    FOR rr IN
      SELECT * FROM public.recurring_rules
       WHERE archived = false AND user_id = u.user_id
         AND starts_on <= v_pending_horizon
    LOOP
      v_horizon := v_pending_horizon;
      IF rr.ends_on IS NOT NULL AND rr.ends_on < v_horizon THEN v_horizon := rr.ends_on; END IF;
      v_step := public.recurring_month_step(rr.frequency);

      SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = rr.id;
      IF v_last IS NULL THEN
        v_cursor := date_trunc('month', rr.starts_on)::date;
      ELSE
        v_cursor := (date_trunc('month', v_last) + (v_step || ' months')::interval)::date;
      END IF;

      WHILE v_cursor <= v_horizon LOOP
        v_due := public.compute_due_date(v_cursor, rr.day_rule, rr.day_of_month);
        IF v_due >= rr.starts_on AND (rr.ends_on IS NULL OR v_due <= rr.ends_on) AND v_due <= v_horizon THEN
          v_eff := public.compute_effective_date(v_due, rr.weekend_adjust);
          IF rr.auto_post
             AND rr.is_variable_amount = false
             AND rr.is_variable_date = false
             AND v_eff <= p_today THEN
            IF rr.is_split = true AND rr.type <> 'transfer' THEN
              v_group := gen_random_uuid();
              v_total := rr.amount;
              v_running := 0;
              v_first_tx_id := NULL;
              SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = rr.id;
              v_idx := 0;
              FOR s IN
                SELECT * FROM public.recurring_rule_slices WHERE rule_id = rr.id ORDER BY sort_order, id
              LOOP
                v_idx := v_idx + 1;
                IF s.amount_ratio IS NOT NULL THEN
                  IF v_idx = v_slice_count THEN
                    v_amt := round((v_total - v_running)::numeric, 2);
                  ELSE
                    v_amt := round((v_total * s.amount_ratio)::numeric, 2);
                  END IF;
                ELSE
                  v_amt := round(COALESCE(s.amount, 0)::numeric, 2);
                END IF;
                v_running := v_running + v_amt;
                INSERT INTO public.transactions
                  (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
                   category_id, description, note, recurring_rule_id, split_group_id,
                   is_reimbursable, reimbursable_status, reimbursable_counterparty, reimbursable_reason)
                VALUES
                  (u.user_id, v_eff, v_amt, rr.type, rr.source_account_id, NULL,
                   s.category_id, s.description, s.note, rr.id, v_group,
                   s.is_reimbursable,
                   CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
                RETURNING id INTO v_tx_id;
                IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
              END LOOP;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (rr.id, v_due, v_eff, 'posted', v_first_tx_id, now())
              ON CONFLICT (rule_id, due_on) DO NOTHING;
            ELSE
              INSERT INTO public.transactions
                (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
              VALUES
                (u.user_id, v_eff, rr.amount, rr.type, rr.source_account_id, rr.destination_account_id, rr.category_id, rr.description, rr.note, rr.id)
              RETURNING id INTO v_tx_id;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (rr.id, v_due, v_eff, 'posted', v_tx_id, now())
              ON CONFLICT (rule_id, due_on) DO NOTHING;
            END IF;
          ELSE
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
            VALUES (rr.id, v_due, v_eff, 'pending')
            ON CONFLICT (rule_id, due_on) DO NOTHING;
          END IF;
        END IF;
        v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$function$;
