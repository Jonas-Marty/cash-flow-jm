
-- ───────── Recurring rules: split + variable date ─────────

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS is_split boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_variable_date boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.recurring_rule_slices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.recurring_rules(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  amount numeric NULL,
  amount_ratio numeric NULL,
  category_id uuid NULL,
  description text NULL,
  note text NULL,
  is_reimbursable boolean NOT NULL DEFAULT false,
  reimbursable_counterparty text NULL,
  reimbursable_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rrs_rule_id ON public.recurring_rule_slices(rule_id);

ALTER TABLE public.recurring_rule_slices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own recurring_rule_slices" ON public.recurring_rule_slices;
CREATE POLICY "own recurring_rule_slices"
  ON public.recurring_rule_slices
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recurring_rules r WHERE r.id = recurring_rule_slices.rule_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recurring_rules r WHERE r.id = recurring_rule_slices.rule_id AND r.user_id = auth.uid()));

-- updated_at trigger (reuse common helper if present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_rrs_updated_at'
  ) THEN
    CREATE TRIGGER trg_rrs_updated_at
      BEFORE UPDATE ON public.recurring_rule_slices
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
EXCEPTION WHEN undefined_function THEN
  -- helper not present; skip
  NULL;
END $$;

-- ───────── Auto-post functions: skip variable-date and split rules ─────────
-- Keep behaviour minimal: variable-date rules are never auto-posted (user must
-- confirm date, like variable-amount). Split rules are also skipped from
-- auto-post for the first iteration — they will be posted via the UI dialog,
-- which handles the split fan-out client-side.

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
       public.interpolate_template(o.description, o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
       public.interpolate_template(o.note,        o.occ_effective_on, o.occ_due_on, v_prev, v_next, p_today, v_run, v_locale),
       (SELECT rule_id FROM public.recurring_occurrences WHERE id = o.occ_id))
    RETURNING id INTO v_tx_id;
    UPDATE public.recurring_occurrences
       SET status = 'posted', transaction_id = v_tx_id, posted_at = now()
     WHERE id = o.occ_id;
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

-- Bulk variant: same skip rules.
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
         AND r.is_split = false
         AND o.status = 'pending'
         AND o.effective_on <= p_today
    LOOP
      INSERT INTO public.transactions
        (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
      VALUES
        (u.user_id, occ.occ_effective_on, occ.amount, occ.type, occ.source_account_id, occ.destination_account_id, occ.category_id, occ.description, occ.note, occ.id)
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
          IF rr.auto_post
             AND rr.is_variable_amount = false
             AND rr.is_variable_date = false
             AND rr.is_split = false
             AND v_eff <= p_today THEN
            INSERT INTO public.transactions
              (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, description, note, recurring_rule_id)
            VALUES
              (u.user_id, v_eff, rr.amount, rr.type, rr.source_account_id, rr.destination_account_id, rr.category_id, rr.description, rr.note, rr.id)
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
