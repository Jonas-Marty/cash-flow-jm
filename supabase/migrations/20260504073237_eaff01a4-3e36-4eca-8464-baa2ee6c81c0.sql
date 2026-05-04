
-- 1. Helper: format a date with a date-fns-like format string, locale-aware (de/en).
CREATE OR REPLACE FUNCTION public.format_date_token(p_date date, p_fmt text, p_locale text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  out text := '';
  i int := 1;
  n int;
  ch text;
  rest text;
  m_idx int;
  d_idx int; -- 0=Sun .. 6=Sat
  months_long_de text[] := ARRAY['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  months_short_de text[] := ARRAY['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
  months_long_en text[] := ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'];
  months_short_en text[] := ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  days_long_de text[] := ARRAY['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  days_short_de text[] := ARRAY['So','Mo','Di','Mi','Do','Fr','Sa'];
  days_long_en text[] := ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  days_short_en text[] := ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  use_de boolean := (lower(coalesce(p_locale,'de')) = 'de');
BEGIN
  IF p_date IS NULL THEN RETURN ''; END IF;
  IF p_fmt IS NULL OR length(p_fmt) = 0 THEN p_fmt := 'yyyy-MM-dd'; END IF;
  n := length(p_fmt);
  m_idx := EXTRACT(MONTH FROM p_date)::int;
  d_idx := EXTRACT(DOW FROM p_date)::int; -- 0..6 Sunday..Saturday

  WHILE i <= n LOOP
    rest := substr(p_fmt, i);
    -- Bracket-escaped literal [ ... ]
    IF substr(rest,1,1) = '[' THEN
      DECLARE close_idx int := position(']' in rest);
      BEGIN
        IF close_idx = 0 THEN
          out := out || substr(rest, 2);
          i := n + 1;
        ELSE
          out := out || substr(rest, 2, close_idx - 2);
          i := i + close_idx;
        END IF;
      END;
      CONTINUE;
    END IF;

    IF substr(rest,1,4) = 'yyyy' THEN
      out := out || lpad(EXTRACT(YEAR FROM p_date)::text, 4, '0'); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,2) = 'yy' THEN
      out := out || lpad((EXTRACT(YEAR FROM p_date)::int % 100)::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,4) = 'MMMM' THEN
      out := out || (CASE WHEN use_de THEN months_long_de[m_idx] ELSE months_long_en[m_idx] END); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,3) = 'MMM' THEN
      out := out || (CASE WHEN use_de THEN months_short_de[m_idx] ELSE months_short_en[m_idx] END); i := i + 3; CONTINUE;
    ELSIF substr(rest,1,2) = 'MM' THEN
      out := out || lpad(m_idx::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,1) = 'M' THEN
      out := out || m_idx::text; i := i + 1; CONTINUE;
    ELSIF substr(rest,1,4) = 'EEEE' OR substr(rest,1,4) = 'dddd' THEN
      out := out || (CASE WHEN use_de THEN days_long_de[d_idx+1] ELSE days_long_en[d_idx+1] END); i := i + 4; CONTINUE;
    ELSIF substr(rest,1,3) = 'EEE' OR substr(rest,1,3) = 'ddd' THEN
      out := out || (CASE WHEN use_de THEN days_short_de[d_idx+1] ELSE days_short_en[d_idx+1] END); i := i + 3; CONTINUE;
    ELSIF substr(rest,1,2) = 'dd' THEN
      out := out || lpad(EXTRACT(DAY FROM p_date)::text, 2, '0'); i := i + 2; CONTINUE;
    ELSIF substr(rest,1,1) = 'd' THEN
      out := out || EXTRACT(DAY FROM p_date)::text; i := i + 1; CONTINUE;
    END IF;

    -- Default: copy character literally
    out := out || substr(rest, 1, 1);
    i := i + 1;
  END LOOP;

  RETURN out;
END;
$fn$;

-- 2. Helper: interpolate ${token[:fmt]} in a template string.
CREATE OR REPLACE FUNCTION public.interpolate_template(
  p_template text,
  p_date date,
  p_due date,
  p_prev date,
  p_next date,
  p_today date,
  p_run int,
  p_locale text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  out text;
  m text[];
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
BEGIN
  IF p_template IS NULL OR length(p_template) = 0 THEN RETURN p_template; END IF;
  out := p_template;

  -- Loop over all matches found in the ORIGINAL template (avoid infinite loops
  -- if a replacement also contains ${...}).
  FOR matches IN
    SELECT regexp_matches(p_template, '\$\{([a-zA-Z]+)(?::([^}]*))?\}', 'g')
  LOOP
    name := matches[1];
    fmt := matches[2];
    match := '${' || name || (CASE WHEN fmt IS NULL THEN '' ELSE ':' || fmt END) || '}';
    d := NULL;
    num := NULL;

    -- Date tokens
    IF name = 'date' THEN d := p_date;
    ELSIF name = 'dueDate' THEN d := p_due;
    ELSIF name = 'prevDate' THEN d := p_prev;
    ELSIF name = 'nextDate' THEN d := p_next;
    ELSIF name = 'periodStart' THEN d := p_period_start;
    ELSIF name = 'periodEnd' THEN d := p_period_end;
    ELSIF name = 'today' THEN d := p_today;
    -- Number tokens
    ELSIF name = 'runNumber' THEN num := p_run;
    ELSIF name = 'quarter' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := (m_zero / 3) + 1;
    ELSIF name = 'semester' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := CASE WHEN m_zero < 6 THEN 1 ELSE 2 END;
    ELSIF name = 'trimester' THEN m_zero := EXTRACT(MONTH FROM p_date)::int - 1; num := (m_zero / 4) + 1;
    ELSIF name = 'weekOfYear' THEN num := EXTRACT(WEEK FROM p_date)::int;
    ELSIF name = 'monthOfYear' THEN num := EXTRACT(MONTH FROM p_date)::int;
    ELSIF name = 'year' THEN num := EXTRACT(YEAR FROM p_date)::int;
    ELSE
      CONTINUE; -- unknown token: leave intact
    END IF;

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

    -- Replace literal occurrences (not regex). Use replace() which is literal.
    out := replace(out, match, replacement);
  END LOOP;

  RETURN out;
END;
$fn$;

-- 3. Replace process_recurring_rules to interpolate description/note on insert.
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

  -- Pass 1
  FOR o IN
    SELECT occ.id AS occ_id, occ.effective_on AS occ_effective_on, occ.due_on AS occ_due_on, rr.*
      FROM public.recurring_occurrences occ
      JOIN public.recurring_rules rr ON rr.id = occ.rule_id
     WHERE rr.user_id = v_uid
       AND rr.archived = false
       AND rr.auto_post = true
       AND rr.is_variable_amount = false
       AND occ.status = 'pending'
       AND occ.effective_on <= p_today
  LOOP
    SELECT MAX(o2.effective_on) INTO v_prev
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = o.id_rule_placeholder; -- will overwrite below
    -- Note: rr.* exposes the rule columns, including id (rule id) under name "id"
    -- Recompute prev/next/run using rule_id explicitly via o.occ_id's rule_id.
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
       public.interpolate_template(o.description, o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
       public.interpolate_template(o.note,        o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
       (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id))
    RETURNING id INTO v_tx_id;
    UPDATE public.recurring_occurrences
       SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
     WHERE id = o.occ_id;
  END LOOP;

  -- Pass 2
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
          SELECT MAX(o2.effective_on) INTO v_prev
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on < v_eff;
          IF v_prev IS NULL THEN v_prev := r.starts_on; END IF;
          SELECT MIN(o2.effective_on) INTO v_next
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on > v_eff;
          SELECT COUNT(*) + 1 INTO v_run
            FROM public.recurring_occurrences o2
           WHERE o2.rule_id = r.id AND o2.effective_on <= v_eff;

          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
          VALUES
            (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id,
             public.interpolate_template(r.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
             public.interpolate_template(r.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
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
      v_cursor := (date_trunc('month', v_cursor) + (v_step || ' months')::interval)::date;
    END LOOP;
  END LOOP;
END;
$function$;

-- 4. Replace bulk processor too.
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
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
  v_pending_horizon date := (date_trunc('month', p_today) + INTERVAL '14 months - 1 day')::date;
  v_step int;
  v_count int := 0;
  v_locale text;
  v_prev date;
  v_next date;
  v_run int;
  v_rule_id uuid;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.recurring_rules WHERE archived = false LOOP
    v_count := v_count + 1;
    SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = u.user_id LIMIT 1;
    IF v_locale IS NULL THEN v_locale := 'de'; END IF;

    FOR occ IN
      SELECT o.id AS occ_id, o.effective_on AS occ_effective_on, o.due_on AS occ_due_on, o.rule_id AS occ_rule_id, r.*
        FROM public.recurring_occurrences o
        JOIN public.recurring_rules r ON r.id = o.rule_id
       WHERE r.user_id = u.user_id
         AND r.archived = false
         AND r.auto_post = true
         AND r.is_variable_amount = false
         AND o.status = 'pending'
         AND o.effective_on <= p_today
    LOOP
      v_rule_id := occ.occ_rule_id;

      SELECT MAX(o2.effective_on) INTO v_prev
        FROM public.recurring_occurrences o2
       WHERE o2.rule_id = v_rule_id AND o2.effective_on < occ.occ_effective_on;
      IF v_prev IS NULL THEN v_prev := occ.starts_on; END IF;
      SELECT MIN(o2.effective_on) INTO v_next
        FROM public.recurring_occurrences o2
       WHERE o2.rule_id = v_rule_id AND o2.effective_on > occ.occ_effective_on;
      SELECT COUNT(*) INTO v_run
        FROM public.recurring_occurrences o2
       WHERE o2.rule_id = v_rule_id AND o2.effective_on <= occ.occ_effective_on;

      INSERT INTO public.transactions
        (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
      VALUES
        (u.user_id, occ.occ_effective_on, occ.amount, occ.type, occ.source_account_id, occ.destination_account_id, occ.category_id,
         public.interpolate_template(occ.description, occ.occ_effective_on, occ.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
         public.interpolate_template(occ.note,        occ.occ_effective_on, occ.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
         v_rule_id)
      RETURNING id INTO v_tx_id;
      UPDATE public.recurring_occurrences
         SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
       WHERE id = occ.occ_id;
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
          IF rr.auto_post AND rr.is_variable_amount = false AND v_eff <= p_today THEN
            SELECT MAX(o2.effective_on) INTO v_prev
              FROM public.recurring_occurrences o2
             WHERE o2.rule_id = rr.id AND o2.effective_on < v_eff;
            IF v_prev IS NULL THEN v_prev := rr.starts_on; END IF;
            SELECT MIN(o2.effective_on) INTO v_next
              FROM public.recurring_occurrences o2
             WHERE o2.rule_id = rr.id AND o2.effective_on > v_eff;
            SELECT COUNT(*) + 1 INTO v_run
              FROM public.recurring_occurrences o2
             WHERE o2.rule_id = rr.id AND o2.effective_on <= v_eff;

            INSERT INTO public.transactions
              (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
            VALUES
              (u.user_id, v_eff, rr.amount, rr.type, rr.source_account_id, rr.destination_account_id, rr.category_id,
               public.interpolate_template(rr.description, v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
               public.interpolate_template(rr.note,        v_eff, v_due, v_prev, v_next, p_today, v_run, v_locale),
               rr.id)
            RETURNING id INTO v_tx_id;
            INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
            VALUES (rr.id, v_due, v_eff, 'posted', v_tx_id, now())
            ON CONFLICT (rule_id, due_on) DO NOTHING;
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

REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM anon;
REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules_for_all_users(date) TO service_role;

-- 5. Backfill: any transactions with unresolved ${...} placeholders that were
-- posted from a recurring rule — interpolate using the rule's date context.
DO $backfill$
DECLARE
  t RECORD;
  v_locale text;
  v_prev date;
  v_next date;
  v_run int;
  v_due date;
  v_new_desc text;
  v_new_note text;
BEGIN
  FOR t IN
    SELECT tx.id, tx.user_id, tx.occurred_on, tx.description, tx.note,
           tx.recurring_rule_id, ro.due_on AS occ_due, r.starts_on AS rule_start
      FROM public.transactions tx
      JOIN public.recurring_rules r ON r.id = tx.recurring_rule_id
      LEFT JOIN public.recurring_occurrences ro ON ro.transaction_id = tx.id
     WHERE tx.recurring_rule_id IS NOT NULL
       AND ((tx.description IS NOT NULL AND tx.description ~ '\$\{[a-zA-Z]+(?::[^}]*)?\}')
         OR (tx.note IS NOT NULL AND tx.note ~ '\$\{[a-zA-Z]+(?::[^}]*)?\}'))
  LOOP
    SELECT format_locale INTO v_locale FROM public.settings WHERE user_id = t.user_id LIMIT 1;
    IF v_locale IS NULL THEN v_locale := 'de'; END IF;

    SELECT MAX(o2.effective_on) INTO v_prev
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = t.recurring_rule_id AND o2.effective_on < t.occurred_on;
    IF v_prev IS NULL THEN v_prev := t.rule_start; END IF;

    SELECT MIN(o2.effective_on) INTO v_next
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = t.recurring_rule_id AND o2.effective_on > t.occurred_on;

    SELECT COUNT(*) INTO v_run
      FROM public.recurring_occurrences o2
     WHERE o2.rule_id = t.recurring_rule_id AND o2.effective_on <= t.occurred_on;
    IF v_run = 0 THEN v_run := 1; END IF;

    v_due := COALESCE(t.occ_due, t.occurred_on);

    v_new_desc := public.interpolate_template(t.description, t.occurred_on, v_due, v_prev, v_next, CURRENT_DATE, v_run, v_locale);
    v_new_note := public.interpolate_template(t.note,        t.occurred_on, v_due, v_prev, v_next, CURRENT_DATE, v_run, v_locale);

    UPDATE public.transactions
       SET description = v_new_desc,
           note        = v_new_note
     WHERE id = t.id;
  END LOOP;
END;
$backfill$;
