-- Month-based period offset for recurring rules.
--
-- The reporting period of an occurrence used to start at
--   month(starts_on) + (n - 1 + period_offset) * interval,
-- i.e. the offset moved the period in whole intervals. With interval > 1 the
-- covered period therefore always started in a month that lines up with the
-- payment month, and common bills could not be described: a quarterly bill
-- for July–September paid on 4 November, a quarter paid on its last day, a
-- yearly premium billed in December for the next year. (Before 20260707 the
-- offset was counted in months, reporting_offset_months; v2 rounded it.)
--
-- Now:  period start = month(starts_on) + (n - 1) * interval + period_offset_months
-- Every existing rule keeps its periods exactly: period_offset_months is
-- filled as period_offset * interval, and for those values both formulas
-- give the same dates.
--
-- period_offset stays for clients that still write it (the app during a
-- deploy); a trigger keeps the two columns consistent. New code reads and
-- writes period_offset_months only.

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS period_offset_months smallint NOT NULL DEFAULT 0;

UPDATE public.recurring_rules
   SET period_offset_months = period_offset * recurrence_interval
 WHERE period_offset <> 0 AND period_offset_months = 0;

ALTER TABLE public.recurring_rules
  DROP CONSTRAINT IF EXISTS recurring_rules_period_offset_months_range;
ALTER TABLE public.recurring_rules
  ADD CONSTRAINT recurring_rules_period_offset_months_range CHECK (period_offset_months BETWEEN -36 AND 36);

COMMENT ON COLUMN public.recurring_rules.period_offset_months IS
  'Months between the month of starts_on and the start of the reporting period of the first occurrence. -4 with a November start: the first payment reports July.';
COMMENT ON COLUMN public.recurring_rules.period_offset IS
  'Deprecated: period_offset_months / recurrence_interval, rounded and clamped to -3..3. Kept in sync by a trigger for old clients.';

-- Keep the two columns consistent. A client that changes period_offset_months
-- wins; an old client that only changes period_offset (or inserts it alone)
-- gets it converted to months.
CREATE OR REPLACE FUNCTION public.sync_recurring_period_offset()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.period_offset_months = 0 AND NEW.period_offset <> 0 THEN
      NEW.period_offset_months := NEW.period_offset * NEW.recurrence_interval;
    END IF;
  ELSIF NEW.period_offset_months IS NOT DISTINCT FROM OLD.period_offset_months
        AND NEW.period_offset IS DISTINCT FROM OLD.period_offset THEN
    NEW.period_offset_months := NEW.period_offset * NEW.recurrence_interval;
  END IF;
  NEW.period_offset := GREATEST(-3, LEAST(3,
    round(NEW.period_offset_months::numeric / NEW.recurrence_interval)::int));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_recurring_period_offset_trg ON public.recurring_rules;
CREATE TRIGGER sync_recurring_period_offset_trg
  BEFORE INSERT OR UPDATE ON public.recurring_rules
  FOR EACH ROW EXECUTE FUNCTION public.sync_recurring_period_offset();

-- The period of the occurrence due on p_due, offset in months.
CREATE OR REPLACE FUNCTION public.period_bounds_for_due_months(
  p_starts_on date, p_ends_on date,
  p_exec_rule public.day_rule, p_exec_dom smallint,
  p_period_rule public.day_rule, p_period_dom smallint,
  p_offset_months smallint, p_interval_months smallint, p_due date,
  OUT period_from date, OUT period_to date
) RETURNS record LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_idx int;
BEGIN
  v_idx := public.exec_index_for_due(p_starts_on, p_ends_on, p_exec_rule, p_exec_dom, p_interval_months, p_due);
  period_from := public.series_step(p_starts_on, p_period_rule, p_period_dom, 1::smallint,
                   (v_idx - 1) * p_interval_months + p_offset_months);
  period_to   := public.series_step(p_starts_on, p_period_rule, p_period_dom, 1::smallint,
                   v_idx * p_interval_months + p_offset_months) - 1;
END;
$$;

-- The interval-based version, for anything still calling it: same dates as before.
CREATE OR REPLACE FUNCTION public.period_bounds_for_due(
  p_starts_on date, p_ends_on date,
  p_exec_rule public.day_rule, p_exec_dom smallint,
  p_period_rule public.day_rule, p_period_dom smallint,
  p_period_offset smallint, p_interval_months smallint, p_due date,
  OUT period_from date, OUT period_to date
) RETURNS record LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT pb.period_from, pb.period_to
    FROM public.period_bounds_for_due_months(p_starts_on, p_ends_on, p_exec_rule, p_exec_dom,
           p_period_rule, p_period_dom, (p_period_offset * p_interval_months)::smallint,
           p_interval_months, p_due) pb;
$$;

-- process_recurring_rules: period from period_offset_months (was period_offset).
CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD; o RECORD;
  v_horizon date; v_due date; v_eff date; v_last date;
  v_n int; v_max_n int;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
  v_locale text; v_pf date; v_pt date; v_run int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = v_uid LIMIT 1;
  IF v_locale IS NULL THEN v_locale := 'de'; END IF;

  FOR o IN
    SELECT occ.id AS occ_id, occ.effective_on AS occ_effective_on, occ.due_on AS occ_due_on, rr.*
      FROM public.recurring_occurrences occ
      JOIN public.recurring_rules rr ON rr.id = occ.rule_id
     WHERE rr.user_id = v_uid AND rr.archived = false AND rr.auto_post = true
       AND rr.is_variable_amount = false AND rr.is_variable_date = false AND rr.is_split = false
       AND occ.status = 'pending' AND occ.effective_on <= p_today
  LOOP
    SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
      FROM public.period_bounds_for_due_months(o.starts_on, o.ends_on,
           o.execution_day_rule, o.execution_day_of_month,
           o.period_day_rule, o.period_day_of_month, o.period_offset_months,
           o.recurrence_interval, o.occ_due_on) pb;
    v_run := public.exec_index_for_due(o.starts_on, o.ends_on,
             o.execution_day_rule, o.execution_day_of_month,
             o.recurrence_interval, o.occ_due_on);
    INSERT INTO public.transactions
      (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
    VALUES
      (v_uid, o.occ_effective_on, o.amount, o.type, o.source_account_id, o.destination_account_id, o.category_id,
       public.interpolate_template(o.description, o.occ_due_on, o.occ_effective_on, v_pf, v_pt, v_run, v_locale),
       public.interpolate_template(o.note,        o.occ_due_on, o.occ_effective_on, v_pf, v_pt, v_run, v_locale),
       o.id)
    RETURNING id INTO v_tx_id;
    UPDATE public.recurring_occurrences SET status = 'posted', transaction_id = v_tx_id, posted_at = now() WHERE id = o.occ_id;
  END LOOP;

  FOR r IN
    SELECT * FROM public.recurring_rules
     WHERE archived = false AND user_id = v_uid AND starts_on <= v_pending_horizon
  LOOP
    v_horizon := v_pending_horizon;
    IF r.ends_on IS NOT NULL AND r.ends_on < v_horizon THEN v_horizon := r.ends_on; END IF;
    SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = r.id;

    v_n := 0; v_max_n := 400;
    IF v_last IS NOT NULL THEN
      WHILE v_n <= v_max_n LOOP
        v_due := public.series_step(r.starts_on, r.execution_day_rule, r.execution_day_of_month, r.recurrence_interval, v_n);
        IF v_due > v_last THEN EXIT; END IF;
        v_n := v_n + 1;
      END LOOP;
    END IF;

    WHILE v_n <= v_max_n LOOP
      v_due := public.series_step(r.starts_on, r.execution_day_rule, r.execution_day_of_month, r.recurrence_interval, v_n);
      IF v_due > v_horizon THEN EXIT; END IF;
      IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) THEN
        v_eff := public.weekend_shift(v_due, r.execution_weekend_adjustment);
        IF r.auto_post AND r.is_variable_amount = false AND r.is_variable_date = false
           AND r.is_split = false AND v_eff <= p_today THEN
          SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
            FROM public.period_bounds_for_due_months(r.starts_on, r.ends_on,
                 r.execution_day_rule, r.execution_day_of_month,
                 r.period_day_rule, r.period_day_of_month, r.period_offset_months,
                 r.recurrence_interval, v_due) pb;
          v_run := public.exec_index_for_due(r.starts_on, r.ends_on,
                   r.execution_day_rule, r.execution_day_of_month,
                   r.recurrence_interval, v_due);
          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
          VALUES
            (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id,
             public.interpolate_template(r.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale),
             public.interpolate_template(r.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale),
             r.id)
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
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
END;
$function$;

-- process_recurring_rules_for_all_users: period from period_offset_months (was period_offset).
CREATE OR REPLACE FUNCTION public.process_recurring_rules_for_all_users(p_today date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  u RECORD; rr RECORD; occ RECORD; s RECORD;
  v_horizon date; v_due date; v_eff date; v_last date;
  v_n int; v_max_n int;
  v_tx_id uuid; v_first_tx_id uuid; v_group uuid;
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
  v_count int := 0;
  v_total numeric; v_running numeric; v_amt numeric;
  v_slice_count int; v_idx int;
  v_locale text; v_pf date; v_pt date; v_run int;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.recurring_rules WHERE archived = false LOOP
    v_count := v_count + 1;
    SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = u.user_id LIMIT 1;
    IF v_locale IS NULL THEN v_locale := 'de'; END IF;

    FOR occ IN
      SELECT o.id AS occ_id, o.effective_on AS occ_effective_on, o.due_on AS occ_due_on, r.*
        FROM public.recurring_occurrences o
        JOIN public.recurring_rules r ON r.id = o.rule_id
       WHERE r.user_id = u.user_id AND r.archived = false AND r.auto_post = true
         AND r.is_variable_amount = false AND r.is_variable_date = false
         AND o.status = 'pending' AND o.effective_on <= p_today
    LOOP
      SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
        FROM public.period_bounds_for_due_months(occ.starts_on, occ.ends_on,
             occ.execution_day_rule, occ.execution_day_of_month,
             occ.period_day_rule, occ.period_day_of_month, occ.period_offset_months,
             occ.recurrence_interval, occ.occ_due_on) pb;
      v_run := public.exec_index_for_due(occ.starts_on, occ.ends_on,
                 occ.execution_day_rule, occ.execution_day_of_month,
                 occ.recurrence_interval, occ.occ_due_on);

      IF occ.is_split = true AND occ.type <> 'transfer' THEN
        v_group := gen_random_uuid();
        v_total := occ.amount; v_running := 0; v_first_tx_id := NULL;
        SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = occ.id;
        v_idx := 0;
        FOR s IN SELECT * FROM public.recurring_rule_slices WHERE rule_id = occ.id ORDER BY sort_order, id LOOP
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
            (u.user_id, occ.occ_effective_on, v_amt, occ.type, occ.source_account_id, NULL,
             s.category_id,
             public.interpolate_template(s.description, occ.occ_due_on, occ.occ_effective_on, v_pf, v_pt, v_run, v_locale),
             public.interpolate_template(s.note,        occ.occ_due_on, occ.occ_effective_on, v_pf, v_pt, v_run, v_locale),
             occ.id, v_group,
             s.is_reimbursable,
             CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
             CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
             CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
          RETURNING id INTO v_tx_id;
          IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
        END LOOP;
        UPDATE public.recurring_occurrences SET status = 'posted', transaction_id = v_first_tx_id, posted_at = now() WHERE id = occ.occ_id;
      ELSE
        INSERT INTO public.transactions
          (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
        VALUES
          (u.user_id, occ.occ_effective_on, occ.amount, occ.type, occ.source_account_id, occ.destination_account_id, occ.category_id,
           public.interpolate_template(occ.description, occ.occ_due_on, occ.occ_effective_on, v_pf, v_pt, v_run, v_locale),
           public.interpolate_template(occ.note,        occ.occ_due_on, occ.occ_effective_on, v_pf, v_pt, v_run, v_locale),
           occ.id)
        RETURNING id INTO v_tx_id;
        UPDATE public.recurring_occurrences SET status = 'posted', transaction_id = v_tx_id, posted_at = now() WHERE id = occ.occ_id;
      END IF;
    END LOOP;

    FOR rr IN
      SELECT * FROM public.recurring_rules
       WHERE archived = false AND user_id = u.user_id AND starts_on <= v_pending_horizon
    LOOP
      v_horizon := v_pending_horizon;
      IF rr.ends_on IS NOT NULL AND rr.ends_on < v_horizon THEN v_horizon := rr.ends_on; END IF;
      SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = rr.id;
      v_n := 0; v_max_n := 400;
      IF v_last IS NOT NULL THEN
        WHILE v_n <= v_max_n LOOP
          v_due := public.series_step(rr.starts_on, rr.execution_day_rule, rr.execution_day_of_month, rr.recurrence_interval, v_n);
          IF v_due > v_last THEN EXIT; END IF;
          v_n := v_n + 1;
        END LOOP;
      END IF;
      WHILE v_n <= v_max_n LOOP
        v_due := public.series_step(rr.starts_on, rr.execution_day_rule, rr.execution_day_of_month, rr.recurrence_interval, v_n);
        IF v_due > v_horizon THEN EXIT; END IF;
        IF v_due >= rr.starts_on AND (rr.ends_on IS NULL OR v_due <= rr.ends_on) THEN
          v_eff := public.weekend_shift(v_due, rr.execution_weekend_adjustment);
          IF rr.auto_post AND rr.is_variable_amount = false AND rr.is_variable_date = false AND v_eff <= p_today THEN
            SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
              FROM public.period_bounds_for_due_months(rr.starts_on, rr.ends_on,
                   rr.execution_day_rule, rr.execution_day_of_month,
                   rr.period_day_rule, rr.period_day_of_month, rr.period_offset_months,
                   rr.recurrence_interval, v_due) pb;
            v_run := public.exec_index_for_due(rr.starts_on, rr.ends_on,
                       rr.execution_day_rule, rr.execution_day_of_month,
                       rr.recurrence_interval, v_due);
            IF rr.is_split = true AND rr.type <> 'transfer' THEN
              v_group := gen_random_uuid();
              v_total := rr.amount; v_running := 0; v_first_tx_id := NULL;
              SELECT COUNT(*) INTO v_slice_count FROM public.recurring_rule_slices WHERE rule_id = rr.id;
              v_idx := 0;
              FOR s IN SELECT * FROM public.recurring_rule_slices WHERE rule_id = rr.id ORDER BY sort_order, id LOOP
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
                  (u.user_id, v_eff, v_amt, rr.type, rr.source_account_id, NULL,
                   s.category_id,
                   public.interpolate_template(s.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   public.interpolate_template(s.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                   rr.id, v_group,
                   s.is_reimbursable,
                   CASE WHEN s.is_reimbursable THEN 'open' ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_counterparty ELSE NULL END,
                   CASE WHEN s.is_reimbursable THEN s.reimbursable_reason ELSE NULL END)
                RETURNING id INTO v_tx_id;
                IF v_first_tx_id IS NULL THEN v_first_tx_id := v_tx_id; END IF;
              END LOOP;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (rr.id, v_due, v_eff, 'posted', v_first_tx_id, now()) ON CONFLICT (rule_id, due_on) DO NOTHING;
            ELSE
              INSERT INTO public.transactions
                (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
              VALUES
                (u.user_id, v_eff, rr.amount, rr.type, rr.source_account_id, rr.destination_account_id, rr.category_id,
                 public.interpolate_template(rr.description, v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                 public.interpolate_template(rr.note,        v_due, v_eff, v_pf, v_pt, v_run, v_locale),
                 rr.id)
              RETURNING id INTO v_tx_id;
              INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
              VALUES (rr.id, v_due, v_eff, 'posted', v_tx_id, now()) ON CONFLICT (rule_id, due_on) DO NOTHING;
            END IF;
          ELSE
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
            VALUES (rr.id, v_due, v_eff, 'pending') ON CONFLICT (rule_id, due_on) DO NOTHING;
          END IF;
        END IF;
        v_n := v_n + 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- apply_recurring_rule_backfill: period from period_offset_months (was period_offset).
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
            FROM public.period_bounds_for_due_months(r.starts_on, r.ends_on,
                 r.execution_day_rule, r.execution_day_of_month,
                 r.period_day_rule, r.period_day_of_month, r.period_offset_months,
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

-- preview_recurring_rule takes the offset in months now. The argument is renamed
-- (callers use named arguments), which needs a drop: Postgres cannot rename it.
DROP FUNCTION IF EXISTS public.preview_recurring_rule(smallint, public.day_rule, smallint, public.weekend_adjust, public.day_rule, smallint, smallint, date, date, date, date);
CREATE OR REPLACE FUNCTION public.preview_recurring_rule(p_recurrence_interval smallint, p_execution_day_rule day_rule, p_execution_day_of_month smallint, p_execution_weekend_adjustment weekend_adjust, p_period_day_rule day_rule, p_period_day_of_month smallint, p_period_offset_months smallint, p_starts_on date, p_ends_on date, p_from date, p_to date)
 RETURNS TABLE(due_on date, effective_on date, period_from date, period_to date, in_past boolean)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := CURRENT_DATE;
  v_end date := LEAST(p_to, COALESCE(p_ends_on, p_to));
  v_n int := 0; v_max_n int := 400;
  v_due date; v_eff date; v_pf date; v_pt date;
BEGIN
  WHILE v_n <= v_max_n LOOP
    v_due := public.series_step(p_starts_on, p_execution_day_rule, p_execution_day_of_month, p_recurrence_interval, v_n);
    IF v_due > v_end THEN EXIT; END IF;
    IF v_due >= p_starts_on AND v_due >= p_from THEN
      v_eff := public.weekend_shift(v_due, p_execution_weekend_adjustment);
      SELECT pb.period_from, pb.period_to INTO v_pf, v_pt
        FROM public.period_bounds_for_due_months(p_starts_on, p_ends_on,
             p_execution_day_rule, p_execution_day_of_month,
             p_period_day_rule, p_period_day_of_month, p_period_offset_months,
             p_recurrence_interval, v_due) pb;
      due_on := v_due; effective_on := v_eff;
      period_from := v_pf; period_to := v_pt;
      in_past := v_eff < v_today;
      RETURN NEXT;
    END IF;
    v_n := v_n + 1;
  END LOOP;
END;
$function$;
