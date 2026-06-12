-- Recurring rules: add reporting_offset_months + period-aware placeholders

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS reporting_offset_months int NOT NULL DEFAULT 0;

-- Extend interpolate_template with new optional rule-context parameters.
-- Existing callers keep working because the new args have defaults.
CREATE OR REPLACE FUNCTION public.interpolate_template(
  p_template text,
  p_date date,
  p_due date,
  p_prev date,
  p_next date,
  p_today date,
  p_run int,
  p_locale text,
  p_starts_on date DEFAULT NULL,
  p_frequency text DEFAULT 'monthly',
  p_reporting_offset_months int DEFAULT 0
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  out text;
  match text;
  name text;
  fmt text;
  replacement text;
  d date;
  num int;
  matches text[];
  p_period_start date := p_prev + 1;
  p_period_end date := p_date;
  m_zero int;
  pad_len int;
  v_step int;
  v_anchor_date date;
  v_m0 int;
  v_diff int;
  v_period_from date;
  v_period_to date;
  v_anchor_year int;
  v_quarter_label text;
BEGIN
  IF p_template IS NULL OR length(p_template) = 0 THEN RETURN p_template; END IF;
  out := p_template;

  -- Derive reporting period [v_period_from, v_period_to] from rule context.
  v_step := CASE p_frequency WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 ELSE 1 END;
  v_anchor_date := (p_date - (p_reporting_offset_months || ' months')::interval)::date;
  IF p_starts_on IS NOT NULL THEN
    v_m0 := EXTRACT(MONTH FROM p_starts_on)::int;
  ELSE
    v_m0 := 1;
  END IF;

  IF v_step = 1 THEN
    v_period_from := date_trunc('month', v_anchor_date)::date;
    v_period_to := (v_period_from + INTERVAL '1 month - 1 day')::date;
  ELSIF v_step = 3 THEN
    v_diff := ((EXTRACT(MONTH FROM v_anchor_date)::int - v_m0) % 3 + 3) % 3;
    v_period_from := (date_trunc('month', v_anchor_date) - (v_diff || ' months')::interval)::date;
    v_period_to := (v_period_from + INTERVAL '3 months - 1 day')::date;
  ELSE  -- yearly
    v_anchor_year := EXTRACT(YEAR FROM v_anchor_date)::int;
    IF EXTRACT(MONTH FROM v_anchor_date)::int < v_m0 THEN
      v_anchor_year := v_anchor_year - 1;
    END IF;
    v_period_from := make_date(v_anchor_year, v_m0, 1);
    v_period_to := (v_period_from + INTERVAL '12 months - 1 day')::date;
  END IF;

  FOR matches IN
    SELECT regexp_matches(p_template, '\$\{([a-zA-Z]+)(?::([^}]*))?\}', 'g')
  LOOP
    name := matches[1];
    fmt := matches[2];
    match := '${' || name || (CASE WHEN fmt IS NULL THEN '' ELSE ':' || fmt END) || '}';
    d := NULL;
    num := NULL;
    replacement := NULL;

    IF name = 'date' THEN d := p_date;
    ELSIF name = 'dueDate' THEN d := p_due;
    ELSIF name = 'prevDate' THEN d := p_prev;
    ELSIF name = 'nextDate' THEN d := p_next;
    ELSIF name = 'periodStart' THEN d := p_period_start;
    ELSIF name = 'periodEnd' THEN d := p_period_end;
    ELSIF name = 'periodFrom' THEN d := v_period_from;
    ELSIF name = 'periodTo' THEN d := v_period_to;
    ELSIF name = 'today' THEN d := p_today;
    -- Number tokens (transaction-date based — kept for compatibility)
    ELSIF name = 'runNumber' THEN num := p_run;
    ELSIF name = 'quarter' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := (m_zero / 3) + 1;
    ELSIF name = 'semester' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := CASE WHEN m_zero < 6 THEN 1 ELSE 2 END;
    ELSIF name = 'trimester' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := (m_zero / 4) + 1;
    ELSIF name = 'weekOfYear' THEN num := EXTRACT(WEEK FROM p_date)::int;
    ELSIF name = 'monthOfYear' THEN num := EXTRACT(MONTH FROM p_date)::int;
    ELSIF name = 'year' THEN num := EXTRACT(YEAR FROM p_date)::int;
    -- Period-based number tokens (use reporting period anchor)
    ELSIF name = 'periodQuarter' THEN m_zero := EXTRACT(MONTH FROM v_period_from)::int - 1; num := (m_zero / 3) + 1;
    ELSIF name = 'periodSemester' THEN m_zero := EXTRACT(MONTH FROM v_period_from)::int - 1; num := CASE WHEN m_zero < 6 THEN 1 ELSE 2 END;
    ELSIF name = 'periodTrimester' THEN m_zero := EXTRACT(MONTH FROM v_period_from)::int - 1; num := (m_zero / 4) + 1;
    ELSIF name = 'periodMonth' THEN num := EXTRACT(MONTH FROM v_period_from)::int;
    ELSIF name = 'periodYear' THEN num := EXTRACT(YEAR FROM v_period_from)::int;
    ELSIF name = 'periodLabel' THEN
      IF v_step = 1 THEN
        replacement := public.format_date_token(v_period_from, COALESCE(fmt, 'MMMM yyyy'), p_locale);
      ELSIF v_step = 3 THEN
        m_zero := EXTRACT(MONTH FROM v_period_from)::int - 1;
        v_quarter_label := 'Q' || ((m_zero / 3) + 1)::text || ' ' || EXTRACT(YEAR FROM v_period_from)::text;
        replacement := v_quarter_label;
      ELSE
        replacement := EXTRACT(YEAR FROM v_period_from)::text;
      END IF;
    ELSE
      CONTINUE;
    END IF;

    IF replacement IS NULL THEN
      IF d IS NOT NULL THEN
        replacement := public.format_date_token(d, fmt, p_locale);
      ELSIF num IS NOT NULL THEN
        IF fmt IS NOT NULL AND fmt ~ '^0+$' THEN
          pad_len := length(fmt);
          replacement := lpad(num::text, pad_len, '0');
        ELSE
          replacement := num::text;
        END IF;
      ELSE
        replacement := '';
      END IF;
    END IF;

    out := replace(out, match, replacement);
  END LOOP;

  RETURN out;
END;
$fn$;

-- Update process_recurring_rules to pass new rule-context args to interpolate_template.
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
  v_locale text;
  v_prev date;
  v_next date;
  v_run int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = v_uid LIMIT 1;
  IF v_locale IS NULL THEN v_locale := 'de'; END IF;

  FOR o IN
    SELECT occ.id AS occ_id, occ.effective_on AS occ_effective_on, occ.due_on AS occ_due_on, rr.*
      FROM public.recurring_occurrences occ
      JOIN public.recurring_rules rr ON rr.id = occ.rule_id
     WHERE rr.user_id = v_uid
       AND rr.archived = false
       AND rr.auto_post = true
       AND rr.is_variable_amount = false
       AND rr.is_variable_date = false
       AND rr.is_split = false
       AND occ.status = 'pending'
       AND occ.effective_on <= p_today
  LOOP
    SELECT MAX(o2.effective_on) INTO v_prev
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id)
       AND o2.effective_on < o.occ_effective_on;
    IF v_prev IS NULL THEN v_prev := o.starts_on; END IF;

    SELECT MIN(o2.effective_on) INTO v_next
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id)
       AND o2.effective_on > o.occ_effective_on;

    SELECT COUNT(*) INTO v_run
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id)
       AND o2.effective_on <= o.occ_effective_on;

    INSERT INTO public.transactions
      (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
    VALUES
      (v_uid, o.occ_effective_on, o.amount, o.type, o.source_account_id, o.destination_account_id, o.category_id,
       public.interpolate_template(o.description, o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale, o.starts_on, o.frequency, COALESCE(o.reporting_offset_months, 0)),
       public.interpolate_template(o.note,        o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale, o.starts_on, o.frequency, COALESCE(o.reporting_offset_months, 0)),
       (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id))
    RETURNING id INTO v_tx_id;
    UPDATE public.recurring_occurrences
       SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
     WHERE id = o.occ_id;
  END LOOP;

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
           AND r.is_split = false
           AND v_eff <= p_today THEN
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