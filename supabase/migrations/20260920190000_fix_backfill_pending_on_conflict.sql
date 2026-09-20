-- apply_recurring_rule_backfill(..., 'pending') has never worked.
--
-- Both of its inserts into pending_transactions end in
--   ON CONFLICT (user_id, external_source, external_ref) DO NOTHING
-- but that index is partial:
--   CREATE UNIQUE INDEX pending_transactions_external_dedupe
--     ON public.pending_transactions (user_id, external_source, external_ref)
--     WHERE external_source IS NOT NULL AND external_ref IS NOT NULL;
-- Postgres only matches a partial index when the ON CONFLICT clause repeats
-- its predicate, so every call raised
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
-- and the whole function aborted before writing anything. The caller caught
-- the error and still reported the rule as saved, so choosing "fill the gap
-- as pending entries" looked like it did nothing at all.
--
-- 'post' mode was unaffected: it inserts into transactions and conflicts on
-- recurring_occurrences (rule_id, due_on), which is a real constraint.
--
-- Body below is the live definition with the predicate added to both clauses.

CREATE OR REPLACE FUNCTION public.apply_recurring_rule_backfill(p_rule_id uuid, p_mode text, p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD; s RECORD;
  v_n int := 0; v_max_n int := 400;
  v_due date; v_eff date;
  v_tx_id uuid; v_first_tx_id uuid; v_group uuid;
  v_uid uuid := auth.uid(); v_mode text := p_mode;
  v_locale text; v_pf date; v_pt date; v_run int;
  v_total numeric; v_running numeric; v_amt numeric;
  v_slice_count int; v_idx int;
  v_ext_ref text; v_desc text; v_note text;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT * INTO r FROM public.recurring_rules WHERE id = p_rule_id AND user_id = v_uid;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.starts_on >= p_today THEN RETURN; END IF;
  IF r.is_variable_amount AND v_mode = 'post' THEN v_mode := 'pending'; END IF;
  SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = v_uid LIMIT 1;
  IF v_locale IS NULL THEN v_locale := 'de'; END IF;

  WHILE v_n <= v_max_n LOOP
    v_due := public.series_step(r.starts_on, r.execution_day_rule, r.execution_day_of_month, r.recurrence_interval, v_n);
    IF v_due > p_today THEN EXIT; END IF;
    IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) THEN
      v_eff := public.weekend_shift(v_due, r.execution_weekend_adjustment);
      IF v_eff <= p_today THEN
        IF EXISTS (SELECT 1 FROM public.recurring_occurrences WHERE rule_id = r.id AND due_on = v_due) THEN
          NULL;
        ELSIF v_mode = 'pending'
          AND EXISTS (SELECT 1 FROM public.pending_transactions
                       WHERE user_id = v_uid AND external_source = 'recurring_backfill'
                         AND external_ref LIKE r.id::text || ':' || v_due::text || ':%') THEN
          NULL;
        ELSE
          SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
            FROM public.period_bounds_for_due(r.starts_on, r.ends_on,
                 r.execution_day_rule, r.execution_day_of_month,
                 r.period_day_rule, r.period_day_of_month, r.period_offset,
                 r.recurrence_interval, v_due) pb;
          v_run := public.exec_index_for_due(r.starts_on, r.ends_on,
                     r.execution_day_rule, r.execution_day_of_month,
                     r.recurrence_interval, v_due);

          IF v_mode = 'post' THEN
            IF r.is_split = true AND r.type <> 'transfer' THEN
              v_group := gen_random_uuid();
              v_total := r.amount; v_running := 0; v_first_tx_id := NULL;
              SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = r.id;
              v_idx := 0;
              FOR s IN SELECT * FROM public.recurring_rule_slices WHERE rule_id = r.id ORDER BY sort_order, id LOOP
                v_idx := v_idx + 1;
                IF s.amount_ratio IS NOT NULL THEN
                  v_amt := CASE WHEN v_idx = v_slice_count THEN round((v_total - v_running)::numeric, 2)
                                ELSE round((v_total * s.amount_ratio)::numeric, 2) END;
                ELSE v_amt := round(COALESCE(s.amount, 0)::numeric, 2); END IF;
                v_running := v_running + v_amt;
                INSERT INTO public.transactions
                  (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
                   category_id, description, note, recurring_rule_id, split_group_id,
                   is_reimbursable, reimbursable_status, reimbursable_counterparty, reimbursable_reason)
                VALUES
                  (v_uid, v_eff, v_amt, r.type, r.source_account_id, NULL,
                   s.category_id,
                   public.interpolate_template(s.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   public.interpolate_template(s.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   r.id, v_group,
                   s.is_reimbursable,
                   CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
                RETURNING id INTO v_tx_id;
                IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
              END LOOP;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (r.id, v_due, v_eff, 'posted', v_first_tx_id, now()) ON CONFLICT (rule_id, due_on) DO NOTHING;
            ELSE
              v_desc := public.interpolate_template(r.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale);
              v_note := public.interpolate_template(r.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale);
              INSERT INTO public.transactions
                (user_id, occurred_on, amount, type, source_account_id, destination_account_id,
                 category_id, description, note, recurring_rule_id)
              VALUES
                (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id,
                 r.category_id, v_desc, v_note, r.id)
              RETURNING id INTO v_tx_id;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (r.id, v_due, v_eff, 'posted', v_tx_id, now()) ON CONFLICT (rule_id, due_on) DO NOTHING;
            END IF;
          ELSIF v_mode = 'pending' THEN
            IF r.is_split = true AND r.type <> 'transfer' AND r.is_variable_amount = false THEN
              v_total := r.amount; v_running := 0;
              SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = r.id;
              v_idx := 0;
              FOR s IN SELECT * FROM public.recurring_rule_slices WHERE rule_id = r.id ORDER BY sort_order, id LOOP
                v_idx := v_idx + 1;
                IF s.amount_ratio IS NOT NULL THEN
                  v_amt := CASE WHEN v_idx = v_slice_count THEN round((v_total - v_running)::numeric, 2)
                                ELSE round((v_total * s.amount_ratio)::numeric, 2) END;
                ELSE v_amt := round(COALESCE(s.amount, 0)::numeric, 2); END IF;
                v_running := v_running + v_amt;
                v_ext_ref := r.id::text || ':' || v_due::text || ':' || v_idx::text;
                INSERT INTO public.pending_transactions
                  (user_id, source_account_id, amount, type, occurred_on,
                   category_id, description, note, external_source, external_ref, external_info)
                VALUES
                  (v_uid, r.source_account_id, v_amt, r.type, v_eff,
                   s.category_id,
                   public.interpolate_template(s.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   public.interpolate_template(s.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   'recurring_backfill', v_ext_ref,
                   'rule=' || r.id::text || ' due=' || v_due::text || ' slice=' || v_idx::text || '/' || v_slice_count::text)
                ON CONFLICT (user_id, external_source, external_ref)
                  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL
                  DO NOTHING;
              END LOOP;
            ELSE
              v_ext_ref := r.id::text || ':' || v_due::text || ':1';
              v_desc := public.interpolate_template(r.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale);
              v_note := public.interpolate_template(r.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale);
              INSERT INTO public.pending_transactions
                (user_id, source_account_id, amount, type, occurred_on,
                 destination_account_id, category_id, description, note,
                 external_source, external_ref, external_info)
              VALUES
                (v_uid, r.source_account_id,
                 COALESCE(r.amount, COALESCE(r.estimated_amount, 0)),
                 r.type, v_eff, r.destination_account_id, r.category_id,
                 v_desc, v_note, 'recurring_backfill', v_ext_ref,
                 'rule=' || r.id::text || ' due=' || v_due::text)
              ON CONFLICT (user_id, external_source, external_ref)
                  WHERE external_source IS NOT NULL AND external_ref IS NOT NULL
                  DO NOTHING;
            END IF;
          ELSE
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
            VALUES (r.id, v_due, v_eff, 'skipped') ON CONFLICT (rule_id, due_on) DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
END;
$function$;
