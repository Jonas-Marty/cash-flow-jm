-- Bulk processor used by a host-level cron job (Option A).
-- Calls process_recurring_rules logic for every user that owns at least one
-- recurring rule. Returns the number of users processed.
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

    -- Pass 1: promote already-pending occurrences whose effective date arrived.
    FOR occ IN
      SELECT o.id AS occ_id, o.effective_on AS occ_effective_on, r.*
        FROM public.recurring_occurrences o
        JOIN public.recurring_rules r ON r.id = o.rule_id
       WHERE r.user_id = u.user_id
         AND r.archived = false
         AND r.auto_post = true
         AND r.is_variable_amount = false
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

    -- Pass 2: extend schedule forward.
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

-- Lock down: only service_role (used by the cron endpoint) may execute.
REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM anon;
REVOKE ALL ON FUNCTION public.process_recurring_rules_for_all_users(date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_recurring_rules_for_all_users(date) TO service_role;