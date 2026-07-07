
CREATE TYPE public.day_rule_v2 AS ENUM ('FixedDay','LastDay','FirstDay');
CREATE TYPE public.weekend_adjust_v2 AS ENUM ('None','PreviousBusinessDay','NextBusinessDay');

DROP TRIGGER IF EXISTS validate_recurring_rule_trg ON public.recurring_rules;
DROP FUNCTION IF EXISTS public.validate_recurring_rule() CASCADE;
DROP FUNCTION IF EXISTS public.preview_recurring_rule(public.recurring_day_rule, integer, public.weekend_adjust, date, date, date, date) CASCADE;
DROP FUNCTION IF EXISTS public.preview_recurring_rule(public.recurring_day_rule, integer, public.weekend_adjust, date, date, date, date, public.recurring_frequency) CASCADE;
DROP FUNCTION IF EXISTS public.interpolate_template(text, date, date, date, date, date, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.interpolate_template(text, date, date, date, date, date, integer, text, date, text, integer) CASCADE;
DROP FUNCTION IF EXISTS public.process_recurring_rules(date) CASCADE;
DROP FUNCTION IF EXISTS public.process_recurring_rules_for_all_users(date) CASCADE;
DROP FUNCTION IF EXISTS public.apply_recurring_rule_backfill(uuid, text, date) CASCADE;
DROP FUNCTION IF EXISTS public.compute_due_date(date, public.recurring_day_rule, integer) CASCADE;
DROP FUNCTION IF EXISTS public.compute_effective_date(date, public.weekend_adjust) CASCADE;
DROP FUNCTION IF EXISTS public.recurring_month_step(public.recurring_frequency) CASCADE;

ALTER TABLE public.recurring_rules
  ADD COLUMN recurrence_interval          smallint,
  ADD COLUMN execution_day_rule           public.day_rule_v2,
  ADD COLUMN execution_day_of_month       smallint,
  ADD COLUMN execution_weekend_adjustment public.weekend_adjust_v2 NOT NULL DEFAULT 'None',
  ADD COLUMN period_day_rule              public.day_rule_v2,
  ADD COLUMN period_day_of_month          smallint,
  ADD COLUMN period_offset                smallint NOT NULL DEFAULT 0;

UPDATE public.recurring_rules SET
  recurrence_interval = CASE frequency
    WHEN 'monthly'   THEN 1 WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12
  END,
  execution_day_rule = CASE day_rule
    WHEN 'fixed_day'      THEN 'FixedDay'::public.day_rule_v2
    WHEN 'end_of_month'   THEN 'LastDay'::public.day_rule_v2
    WHEN 'first_of_month' THEN 'FirstDay'::public.day_rule_v2
  END,
  execution_day_of_month = CASE WHEN day_rule = 'fixed_day' THEN day_of_month::smallint ELSE NULL END,
  execution_weekend_adjustment = CASE weekend_adjust
    WHEN 'none'   THEN 'None'::public.weekend_adjust_v2
    WHEN 'before' THEN 'PreviousBusinessDay'::public.weekend_adjust_v2
    WHEN 'after'  THEN 'NextBusinessDay'::public.weekend_adjust_v2
  END,
  period_day_rule = CASE day_rule
    WHEN 'fixed_day'      THEN 'FixedDay'::public.day_rule_v2
    WHEN 'end_of_month'   THEN 'LastDay'::public.day_rule_v2
    WHEN 'first_of_month' THEN 'FirstDay'::public.day_rule_v2
  END,
  period_day_of_month = CASE WHEN day_rule = 'fixed_day' THEN day_of_month::smallint ELSE NULL END,
  period_offset = GREATEST(-3, LEAST(3,
    round(
      COALESCE(reporting_offset_months, 0)::numeric /
      (CASE frequency WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 END)::numeric
    )::int
  ));

INSERT INTO public.audit_logs (user_id, action, table_name, row_id, metadata)
SELECT user_id, 'custom'::text, 'recurring_rules'::text, id::text,
  jsonb_build_object(
    'event', 'recurrence_v2_migration',
    'note', 'reporting_offset_months did not divide evenly by new interval; period_offset was rounded',
    'old_frequency', frequency::text,
    'old_reporting_offset_months', reporting_offset_months,
    'new_recurrence_interval', recurrence_interval,
    'new_period_offset', period_offset
  )
FROM public.recurring_rules
WHERE reporting_offset_months IS NOT NULL
  AND reporting_offset_months <> 0
  AND (reporting_offset_months % (CASE frequency WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'yearly' THEN 12 END)) <> 0;

ALTER TABLE public.recurring_rules
  ALTER COLUMN recurrence_interval SET NOT NULL,
  ALTER COLUMN execution_day_rule  SET NOT NULL,
  ALTER COLUMN period_day_rule     SET NOT NULL,
  ADD CONSTRAINT recurring_rules_interval_range         CHECK (recurrence_interval BETWEEN 1 AND 12),
  ADD CONSTRAINT recurring_rules_exec_dom_range         CHECK (execution_day_of_month IS NULL OR execution_day_of_month BETWEEN 1 AND 31),
  ADD CONSTRAINT recurring_rules_period_dom_range       CHECK (period_day_of_month    IS NULL OR period_day_of_month    BETWEEN 1 AND 31),
  ADD CONSTRAINT recurring_rules_period_offset_range    CHECK (period_offset BETWEEN -3 AND 3),
  ADD CONSTRAINT recurring_rules_exec_dom_required      CHECK (
    (execution_day_rule = 'FixedDay' AND execution_day_of_month IS NOT NULL)
    OR execution_day_rule <> 'FixedDay'
  ),
  ADD CONSTRAINT recurring_rules_period_dom_required    CHECK (
    (period_day_rule = 'FixedDay' AND period_day_of_month IS NOT NULL)
    OR period_day_rule <> 'FixedDay'
  );

ALTER TABLE public.recurring_rules
  DROP COLUMN frequency,
  DROP COLUMN day_rule,
  DROP COLUMN day_of_month,
  DROP COLUMN weekend_adjust,
  DROP COLUMN reporting_offset_months;

DROP TYPE IF EXISTS public.recurring_frequency;
DROP TYPE IF EXISTS public.recurring_day_rule;
DROP TYPE IF EXISTS public.weekend_adjust;

CREATE OR REPLACE FUNCTION public.series_step(
  p_anchor date, p_rule public.day_rule_v2, p_dom smallint,
  p_interval_months smallint, p_n integer
) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  v_base date := (date_trunc('month', p_anchor) + (p_n * p_interval_months || ' months')::interval)::date;
  v_last date := (date_trunc('month', v_base) + INTERVAL '1 month - 1 day')::date;
  v_day int;
BEGIN
  IF p_rule = 'FirstDay' THEN RETURN v_base;
  ELSIF p_rule = 'LastDay' THEN RETURN v_last;
  ELSE
    v_day := LEAST(COALESCE(p_dom, 1)::int, EXTRACT(DAY FROM v_last)::int);
    RETURN v_base + (v_day - 1);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.weekend_shift(p_date date, p_adj public.weekend_adjust_v2)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_dow int;
BEGIN
  IF p_adj = 'None' THEN RETURN p_date; END IF;
  v_dow := EXTRACT(ISODOW FROM p_date);
  IF p_adj = 'PreviousBusinessDay' THEN
    IF v_dow = 6 THEN RETURN p_date - 1; ELSIF v_dow = 7 THEN RETURN p_date - 2; END IF;
  ELSIF p_adj = 'NextBusinessDay' THEN
    IF v_dow = 6 THEN RETURN p_date + 2; ELSIF v_dow = 7 THEN RETURN p_date + 1; END IF;
  END IF;
  RETURN p_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.exec_index_for_due(
  p_starts_on date, p_ends_on date,
  p_exec_rule public.day_rule_v2, p_exec_dom smallint,
  p_interval_months smallint, p_due date
) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_step_n int; v_skip int;
BEGIN
  v_step_n := (
    (EXTRACT(YEAR  FROM p_due)::int - EXTRACT(YEAR  FROM p_starts_on)::int) * 12
    + (EXTRACT(MONTH FROM p_due)::int - EXTRACT(MONTH FROM p_starts_on)::int)
  ) / p_interval_months;
  v_skip := CASE WHEN public.series_step(p_starts_on, p_exec_rule, p_exec_dom, p_interval_months, 0) < p_starts_on THEN 1 ELSE 0 END;
  RETURN v_step_n - v_skip + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.period_bounds_for_due(
  p_starts_on date, p_ends_on date,
  p_exec_rule public.day_rule_v2, p_exec_dom smallint,
  p_period_rule public.day_rule_v2, p_period_dom smallint,
  p_period_offset smallint, p_interval_months smallint, p_due date,
  OUT period_from date, OUT period_to date
) RETURNS record LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE v_idx int;
BEGIN
  v_idx := public.exec_index_for_due(p_starts_on, p_ends_on, p_exec_rule, p_exec_dom, p_interval_months, p_due);
  period_from := public.series_step(p_starts_on, p_period_rule, p_period_dom, p_interval_months, v_idx - 1 + p_period_offset);
  period_to   := public.series_step(p_starts_on, p_period_rule, p_period_dom, p_interval_months, v_idx     + p_period_offset) - 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.format_date_token(p_date date, p_fmt text, p_locale text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  out text := ''; i int := 1; n int; rest text; m_idx int; d_idx int; q_idx int;
  months_long_de text[]  := ARRAY['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  months_short_de text[] := ARRAY['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  months_long_en text[]  := ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'];
  months_short_en text[] := ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  days_long_de text[]    := ARRAY['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  days_short_de text[]   := ARRAY['So','Mo','Di','Mi','Do','Fr','Sa'];
  days_long_en text[]    := ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  days_short_en text[]   := ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  use_de boolean := (lower(coalesce(p_locale,'de')) = 'de');
BEGIN
  IF p_date IS NULL THEN RETURN ''; END IF;
  IF p_fmt IS NULL OR length(p_fmt) = 0 THEN p_fmt := 'yyyy-MM-dd'; END IF;
  n := length(p_fmt);
  m_idx := EXTRACT(MONTH FROM p_date)::int;
  d_idx := EXTRACT(DOW   FROM p_date)::int;
  q_idx := ((m_idx - 1) / 3) + 1;

  WHILE i <= n LOOP
    rest := substr(p_fmt, i);
    IF substr(rest,1,1) = '[' THEN
      DECLARE close_idx int := position(']' in rest);
      BEGIN
        IF close_idx = 0 THEN out := out || substr(rest, 2); i := n + 1;
        ELSE out := out || substr(rest, 2, close_idx - 2); i := i + close_idx;
        END IF;
      END;
      CONTINUE;
    END IF;

    IF    substr(rest,1,4) = 'yyyy' THEN out := out || lpad(EXTRACT(YEAR FROM p_date)::text, 4, '0'); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,2) = 'yy'   THEN out := out || lpad((EXTRACT(YEAR FROM p_date)::int % 100)::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,4) = 'MMMM' THEN out := out || (CASE WHEN use_de THEN months_long_de[m_idx]  ELSE months_long_en[m_idx]  END); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,3) = 'MMM'  THEN out := out || (CASE WHEN use_de THEN months_short_de[m_idx] ELSE months_short_en[m_idx] END); i := i + 3; CONTINUE;
    ELSIF substr(rest,1,2) = 'MM'   THEN out := out || lpad(m_idx::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,1) = 'M'    THEN out := out || m_idx::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,4) = 'EEEE' OR substr(rest,1,4) = 'dddd' THEN out := out || (CASE WHEN use_de THEN days_long_de[d_idx+1]  ELSE days_long_en[d_idx+1]  END); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,3) = 'EEE'  OR substr(rest,1,3) = 'ddd'  THEN out := out || (CASE WHEN use_de THEN days_short_de[d_idx+1] ELSE days_short_en[d_idx+1] END); i := i + 3; CONTINUE;
    ELSIF substr(rest,1,2) = 'dd'   THEN out := out || lpad(EXTRACT(DAY FROM p_date)::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,1) = 'd'    THEN out := out || EXTRACT(DAY FROM p_date)::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,1) = 'Q'    THEN out := out || q_idx::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,1) = 'S'    THEN out := out || (CASE WHEN m_idx <= 6 THEN 1 ELSE 2 END)::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,1) = 'T'    THEN out := out || (((m_idx - 1) / 4) + 1)::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,2) = 'ww'   THEN out := out || lpad(EXTRACT(WEEK FROM p_date)::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,1) = 'w'    THEN out := out || EXTRACT(WEEK FROM p_date)::text; i := i + 1; CONTINUE;
    END IF;

    out := out || substr(rest, 1, 1);
    i := i + 1;
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.interpolate_template(
  p_template text, p_due date, p_date date, p_period_from date, p_period_to date,
  p_run integer, p_locale text
) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE
  out text; matches text[]; name text; fmt text; match text; d date; replacement text; pad_len int;
BEGIN
  IF p_template IS NULL OR length(p_template) = 0 THEN RETURN p_template; END IF;
  out := p_template;

  FOR matches IN SELECT regexp_matches(p_template, '\$\{([a-zA-Z]+)(?::([^}]*))?\}', 'g') LOOP
    name := matches[1]; fmt := matches[2];
    match := '${' || name || (CASE WHEN fmt IS NULL THEN '' ELSE ':' || fmt END) || '}';
    d := NULL; replacement := NULL;

    IF    name = 'date'       THEN d := p_date;
    ELSIF name = 'dueDate'    THEN d := p_due;
    ELSIF name = 'periodFrom' THEN d := p_period_from;
    ELSIF name = 'periodTo'   THEN d := p_period_to;
    ELSIF name = 'runNumber'  THEN
      IF fmt IS NOT NULL AND fmt ~ '^0+$' THEN pad_len := length(fmt); replacement := lpad(p_run::text, pad_len, '0');
      ELSE replacement := p_run::text; END IF;
    ELSE replacement := '';
    END IF;

    IF replacement IS NULL THEN
      IF d IS NULL THEN replacement := '';
      ELSE replacement := public.format_date_token(d, fmt, p_locale); END IF;
    END IF;

    out := replace(out, match, replacement);
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_recurring_rule(
  p_recurrence_interval smallint,
  p_execution_day_rule public.day_rule_v2, p_execution_day_of_month smallint,
  p_execution_weekend_adjustment public.weekend_adjust_v2,
  p_period_day_rule public.day_rule_v2, p_period_day_of_month smallint,
  p_period_offset smallint,
  p_starts_on date, p_ends_on date, p_from date, p_to date
) RETURNS TABLE(due_on date, effective_on date, period_from date, period_to date, in_past boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
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
        FROM public.period_bounds_for_due(p_starts_on, p_ends_on,
             p_execution_day_rule, p_execution_day_of_month,
             p_period_day_rule, p_period_day_of_month, p_period_offset,
             p_recurrence_interval, v_due) pb;
      due_on := v_due; effective_on := v_eff;
      period_from := v_pf; period_to := v_pt;
      in_past := v_eff < v_today;
      RETURN NEXT;
    END IF;
    v_n := v_n + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_recurring_rule()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.is_variable_amount = false AND NEW.amount IS NULL THEN
    RAISE EXCEPTION 'amount is required for fixed-amount rules';
  END IF;
  IF NEW.is_variable_amount = true AND NEW.auto_post = true THEN
    RAISE EXCEPTION 'variable-amount rules cannot auto-post';
  END IF;
  IF NEW.execution_day_rule = 'FixedDay' AND NEW.execution_day_of_month IS NULL THEN
    RAISE EXCEPTION 'execution_day_of_month is required when execution_day_rule = FixedDay';
  END IF;
  IF NEW.period_day_rule = 'FixedDay' AND NEW.period_day_of_month IS NULL THEN
    RAISE EXCEPTION 'period_day_of_month is required when period_day_rule = FixedDay';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_recurring_rule_trg
BEFORE INSERT OR UPDATE ON public.recurring_rules
FOR EACH ROW EXECUTE FUNCTION public.validate_recurring_rule();

CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
      FROM public.period_bounds_for_due(o.starts_on, o.ends_on,
           o.execution_day_rule, o.execution_day_of_month,
           o.period_day_rule, o.period_day_of_month, o.period_offset,
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
            FROM public.period_bounds_for_due(r.starts_on, r.ends_on,
                 r.execution_day_rule, r.execution_day_of_month,
                 r.period_day_rule, r.period_day_of_month, r.period_offset,
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
$$;

CREATE OR REPLACE FUNCTION public.process_recurring_rules_for_all_users(p_today date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
        FROM public.period_bounds_for_due(occ.starts_on, occ.ends_on,
             occ.execution_day_rule, occ.execution_day_of_month,
             occ.period_day_rule, occ.period_day_of_month, occ.period_offset,
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
              FROM public.period_bounds_for_due(rr.starts_on, rr.ends_on,
                   rr.execution_day_rule, rr.execution_day_of_month,
                   rr.period_day_rule, rr.period_day_of_month, rr.period_offset,
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
$$;

CREATE OR REPLACE FUNCTION public.apply_recurring_rule_backfill(p_rule_id uuid, p_mode text, p_today date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
                ON CONFLICT (user_id, external_source, external_ref) DO NOTHING;
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
              ON CONFLICT (user_id, external_source, external_ref) DO NOTHING;
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
$$;
