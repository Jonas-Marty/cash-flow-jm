CREATE OR REPLACE FUNCTION public.apply_recurring_rule_backfill(p_rule_id uuid, p_mode text, p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  s RECORD;
  v_cursor date;
  v_due date;
  v_eff date;
  v_tx_id uuid;
  v_first_tx_id uuid;
  v_group uuid;
  v_uid uuid := auth.uid();
  v_mode text := p_mode;
  v_locale text;
  v_prev date;
  v_next date;
  v_run int;
  v_total numeric;
  v_running numeric;
  v_amt numeric;
  v_slice_count int;
  v_idx int;
  v_step int;
  v_ext_ref text;
  v_desc text;
  v_note text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO r FROM public.recurring_rules
   WHERE id = p_rule_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.starts_on >= p_today THEN RETURN; END IF;

  -- Variable-amount rules cannot auto-post (no amount known). Coerce 'post'
  -- to 'pending' so the user still gets entries to fill in manually.
  IF r.is_variable_amount AND v_mode = 'post' THEN
    v_mode := 'pending';
  END IF;

  SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = v_uid LIMIT 1;
  IF v_locale IS NULL THEN v_locale := 'de'; END IF;

  v_step := public.recurring_month_step(r.frequency);
  v_cursor := date_trunc('month', r.starts_on)::date;

  WHILE v_cursor <= p_today LOOP
    v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
    IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) THEN
      v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
      IF v_eff <= p_today THEN
        -- Skip if this occurrence (or its pending_transactions counterpart)
        -- already exists.
        IF EXISTS (SELECT 1 FROM public.recurring_occurrences
                    WHERE rule_id = r.id AND due_on = v_due) THEN
          -- already tracked; move on
          NULL;
        ELSIF v_mode = 'pending'
          AND EXISTS (SELECT 1 FROM public.pending_transactions
                       WHERE user_id = v_uid
                         AND external_source = 'recurring_backfill'
                         AND external_ref LIKE r.id::text || ':' || v_due::text || ':%') THEN
          NULL;
        ELSE
          -- Build per-occurrence interpolation context.
          SELECT MAX(o2.effective_on) INTO v_prev
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on < v_eff;
          IF v_prev IS NULL THEN v_prev := r.starts_on; END IF;
          SELECT MIN(o2.effective_on) INTO v_next
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on > v_eff;
          SELECT COUNT(*) + 1 INTO v_run
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on < v_eff;

          IF v_mode = 'post' THEN
            IF r.is_split = true AND r.type <> 'transfer' THEN
              v_group := gen_random_uuid();
              v_total := r.amount;
              v_running := 0;
              v_first_tx_id := NULL;
              SELECT COUNT(*) INTO v_slice_count
                FROM public.recurring_rule_slices WHERE rule_id = r.id;
              v_idx := 0;
              FOR s IN
                SELECT * FROM public.recurring_rule_slices
                 WHERE rule_id = r.id ORDER BY sort_order, id
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
                   s.category_id,
                   public.interpolate_template(s.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
                   public.interpolate_template(s.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
                   r.id, v_group,
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
              v_desc := public.interpolate_template(r.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale);
              v_note := public.interpolate_template(r.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale);
              INSERT INTO public.transactions
                (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
                 category_id, description, note, recurring_rule_id)
              VALUES
                (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id,
                 r.category_id, v_desc, v_note, r.id)
              RETURNING id INTO v_tx_id;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (r.id, v_due, v_eff, 'posted', v_tx_id, now())
              ON CONFLICT (rule_id, due_on) DO NOTHING;
            END IF;
          ELSIF v_mode = 'pending' THEN
            -- Write one (or N for splits) pending_transactions rows so they
            -- show up in the Pending confirmations list. The original
            -- pending recurring_occurrence is NOT created here so the
            -- scheduler doesn't auto-post it on the next cron pass.
            IF r.is_split = true AND r.type <> 'transfer' AND r.is_variable_amount = false THEN
              v_total := r.amount;
              v_running := 0;
              SELECT COUNT(*) INTO v_slice_count
                FROM public.recurring_rule_slices WHERE rule_id = r.id;
              v_idx := 0;
              FOR s IN
                SELECT * FROM public.recurring_rule_slices
                 WHERE rule_id = r.id ORDER BY sort_order, id
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
                v_ext_ref := r.id::text || ':' || v_due::text || ':' || v_idx::text;
                INSERT INTO public.pending_transactions
                  (user_id, source_account_id, amount, type, occurred_on,
                   category_id, description, note, external_source, external_ref, external_info)
                VALUES
                  (v_uid, r.source_account_id, v_amt, r.type, v_eff,
                   s.category_id,
                   public.interpolate_template(s.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
                   public.interpolate_template(s.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
                   'recurring_backfill', v_ext_ref,
                   'rule=' || r.id::text || ' due=' || v_due::text || ' slice=' || v_idx::text || '/' || v_slice_count::text)
                ON CONFLICT (user_id, external_source, external_ref) DO NOTHING;
              END LOOP;
            ELSE
              -- Single (non-split, or variable-amount fallback) pending row.
              v_ext_ref := r.id::text || ':' || v_due::text || ':1';
              v_desc := public.interpolate_template(r.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale);
              v_note := public.interpolate_template(r.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale);
              INSERT INTO public.pending_transactions
                (user_id, source_account_id, amount, type, occurred_on,
                 destination_account_id, category_id, description, note,
                 external_source, external_ref, external_info)
              VALUES
                (v_uid, r.source_account_id,
                 COALESCE(r.amount, COALESCE(r.estimated_amount, 0)),
                 r.type, v_eff,
                 r.destination_account_id, r.category_id,
                 v_desc, v_note,
                 'recurring_backfill', v_ext_ref,
                 'rule=' || r.id::text || ' due=' || v_due::text)
              ON CONFLICT (user_id, external_source, external_ref) DO NOTHING;
            END IF;
          ELSE
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
            VALUES (r.id, v_due, v_eff, 'skipped')
            ON CONFLICT (rule_id, due_on) DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
  END LOOP;
END;
$function$;