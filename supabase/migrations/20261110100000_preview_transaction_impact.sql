-- The Auswirkung card, worked out by the database for both of its questions.
--
-- Editing an entry, the card mixed two answers: accounts showed the entry as if
-- booked new, budgets showed what saving the edit changes. It now asks for
-- both, and every figure comes from here.
--
-- preview_transaction_impact(p_ops, p_entry_ids) takes three snapshots:
--
--   now      as the books are
--   without  without the entry being edited (p_entry_ids deleted), with its
--            reimbursement links gone too
--   after    with the change applied (p_ops, as for preview_transaction_change)
--
-- "This edit" is now → after; "this entry" is without → after. For a new entry
-- p_entry_ids is empty and without equals now. Each snapshot runs in a block
-- that is always rolled back, so nothing persists.
--
-- Next to what preview_snapshot() keeps, a snapshot here also holds:
--
--   person   what one person still owes you (an open reimbursable expense) or
--            you owe them (an open reimbursable income), by counterparty
--   month    whether the month is over and swept, and where its leftover goes
--
-- A change the database would refuse comes back as one row with kind 'error'.

CREATE OR REPLACE FUNCTION public.preview_impact_snapshot(p_as_of date, p_months date[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH default_target AS (
    SELECT default_sweep_category_id AS tgt FROM public.settings WHERE user_id = auth.uid() LIMIT 1
  )
  SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM (
    SELECT 'account:' || a.id AS k,
           jsonb_build_object('kind', 'account', 'id', a.id, 'value', public.account_balance(a.id)) AS v
      FROM public.accounts a
     WHERE a.user_id = auth.uid() AND NOT a.archived
    UNION ALL
    SELECT 'envelope:' || b.category_id,
           jsonb_build_object('kind', 'envelope', 'id', b.category_id, 'value', b.cumulative_balance)
      FROM public.category_savings_balance(p_as_of) b
    UNION ALL
    -- Swept the way category_savings_balance() sweeps: a budgeted month that is
    -- over sends its leftover to the budget's, its group's or the default target.
    SELECT 'month:' || r.category_id || ':' || m.month,
           jsonb_build_object('kind', 'month', 'id', r.category_id, 'month', m.month,
                              'income', r.kind = 'income', 'allocated', r.allocated,
                              'value', CASE WHEN r.kind = 'income' THEN r.spent_or_received
                                            ELSE r.allocated - r.spent_or_received END,
                              'closed', m.month + INTERVAL '1 month' <= p_as_of,
                              'sweep_target', CASE
                                WHEN m.month + INTERVAL '1 month' <= p_as_of
                                 AND EXISTS (SELECT 1 FROM public.category_budgets cb
                                              WHERE cb.category_id = r.category_id AND cb.month = m.month)
                                THEN COALESCE(c.sweep_target_category_id, g.sweep_target_category_id,
                                              (SELECT tgt FROM default_target))
                              END)
      FROM unnest(p_months) AS m(month)
      CROSS JOIN LATERAL public.category_month_spending(m.month) r
      JOIN public.categories c ON c.id = r.category_id
      LEFT JOIN public.category_groups g ON g.id = c.group_id
     WHERE NOT r.rolls_over AND NOT r.is_scope
    UNION ALL
    SELECT 'unallocated',
           jsonb_build_object('kind', 'unallocated', 'value', e.unallocated)
      FROM public.envelope_reconciliation(p_as_of) e
    UNION ALL
    SELECT 'person:' || p.dir || ':' || p.who,
           jsonb_build_object('kind', 'person', 'label', p.label, 'income', p.dir = 'owe', 'value', p.open)
      FROM (
        SELECT CASE WHEN t.type = 'income' THEN 'owe' ELSE 'owed' END AS dir,
               lower(btrim(COALESCE(t.reimbursable_counterparty, ''))) AS who,
               min(btrim(COALESCE(t.reimbursable_counterparty, ''))) AS label,
               SUM(GREATEST(0, t.amount - COALESCE((
                 SELECT SUM(l.amount) FROM public.transaction_reimbursements l
                  WHERE l.original_transaction_id = t.id), 0))) AS open
          FROM public.transactions t
         WHERE t.user_id = auth.uid()
           AND t.is_reimbursable
           AND t.reimbursable_status = 'open'
           AND t.type <> 'transfer'
         GROUP BY 1, 2
      ) p
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.preview_impact_snapshot(date, date[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_impact_snapshot(date, date[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_transaction_impact(p_ops jsonb, p_entry_ids uuid[] DEFAULT '{}')
 RETURNS TABLE(kind text, ref_id uuid, month date, label text, now numeric, without numeric, after numeric,
               allocated numeric, income boolean, closed boolean, sweep_target uuid, error text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_op jsonb;
  v_row jsonb;
  v_dates date[];
  v_months date[];
  v_as_of date;
  v_now jsonb;
  v_without jsonb;
  v_after jsonb;
  v_error text := NULL;
  r public.transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) = 0 THEN RETURN; END IF;
  p_entry_ids := COALESCE(p_entry_ids, '{}');

  -- Every date the change touches: new dates, and the current dates of the
  -- rows it updates or deletes or that make up the entry.
  SELECT array_agg(DISTINCT d) INTO v_dates FROM (
    SELECT (o->'row'->>'occurred_on')::date AS d FROM jsonb_array_elements(p_ops) o
     WHERE o->'row' ? 'occurred_on'
    UNION
    SELECT t.occurred_on FROM jsonb_array_elements(p_ops) o
      JOIN public.transactions t ON t.id = (o->>'id')::uuid
     WHERE o->>'op' IN ('update', 'delete')
    UNION
    SELECT t.occurred_on FROM public.transactions t WHERE t.id = ANY (p_entry_ids)
    UNION
    SELECT CURRENT_DATE FROM jsonb_array_elements(p_ops) o
     WHERE o->>'op' = 'insert' AND NOT (o->'row' ? 'occurred_on')
  ) x WHERE d IS NOT NULL;
  v_dates := COALESCE(v_dates, ARRAY[CURRENT_DATE]);
  SELECT array_agg(DISTINCT date_trunc('month', d)::date) INTO v_months FROM unnest(v_dates) d;
  SELECT GREATEST(CURRENT_DATE, MAX(d)) INTO v_as_of FROM unnest(v_dates) d;

  v_now := public.preview_impact_snapshot(v_as_of, v_months);
  v_without := v_now;

  IF cardinality(p_entry_ids) > 0 THEN
    BEGIN
      DELETE FROM public.transactions WHERE id = ANY (p_entry_ids) AND user_id = v_uid;
      v_without := public.preview_impact_snapshot(v_as_of, v_months);
      RAISE EXCEPTION 'preview rolled back' USING ERRCODE = 'P0099';
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN NULL;
      WHEN OTHERS THEN v_error := SQLERRM;
    END;
  END IF;

  IF v_error IS NULL THEN
    BEGIN
      FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
        v_row := COALESCE(v_op->'row', '{}'::jsonb);
        r := jsonb_populate_record(NULL::public.transactions, v_row);
        IF v_op->>'op' = 'insert' THEN
          INSERT INTO public.transactions
            (user_id, type, amount, destination_amount, source_account_id, destination_account_id,
             category_id, occurred_on, description, difference_category_id, is_reimbursable,
             reimbursable_counterparty)
          VALUES
            (v_uid, r.type, r.amount, r.destination_amount, r.source_account_id, r.destination_account_id,
             r.category_id, COALESCE(r.occurred_on, CURRENT_DATE), r.description, r.difference_category_id,
             COALESCE(r.is_reimbursable, false), r.reimbursable_counterparty);
        ELSIF v_op->>'op' = 'update' THEN
          UPDATE public.transactions t SET
            type = CASE WHEN v_row ? 'type' THEN r.type ELSE t.type END,
            amount = CASE WHEN v_row ? 'amount' THEN r.amount ELSE t.amount END,
            destination_amount = CASE WHEN v_row ? 'destination_amount' THEN r.destination_amount ELSE t.destination_amount END,
            source_account_id = CASE WHEN v_row ? 'source_account_id' THEN r.source_account_id ELSE t.source_account_id END,
            destination_account_id = CASE WHEN v_row ? 'destination_account_id' THEN r.destination_account_id ELSE t.destination_account_id END,
            category_id = CASE WHEN v_row ? 'category_id' THEN r.category_id ELSE t.category_id END,
            occurred_on = CASE WHEN v_row ? 'occurred_on' THEN r.occurred_on ELSE t.occurred_on END,
            description = CASE WHEN v_row ? 'description' THEN r.description ELSE t.description END,
            difference_category_id = CASE WHEN v_row ? 'difference_category_id' THEN r.difference_category_id ELSE t.difference_category_id END,
            is_reimbursable = CASE WHEN v_row ? 'is_reimbursable' THEN COALESCE(r.is_reimbursable, false) ELSE t.is_reimbursable END,
            reimbursable_counterparty = CASE WHEN v_row ? 'reimbursable_counterparty' THEN r.reimbursable_counterparty ELSE t.reimbursable_counterparty END
           WHERE t.id = (v_op->>'id')::uuid AND t.user_id = v_uid;
        ELSIF v_op->>'op' = 'delete' THEN
          DELETE FROM public.transactions WHERE id = (v_op->>'id')::uuid AND user_id = v_uid;
        ELSE
          RAISE EXCEPTION 'unknown preview operation %', v_op->>'op';
        END IF;
      END LOOP;

      v_after := public.preview_impact_snapshot(v_as_of, v_months);
      RAISE EXCEPTION 'preview rolled back' USING ERRCODE = 'P0099';
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN NULL;
      WHEN OTHERS THEN v_error := SQLERRM;
    END;
  END IF;

  IF v_error IS NOT NULL THEN
    kind := 'error'; error := v_error;
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  WITH keys AS (
    SELECT k FROM jsonb_object_keys(v_now) k
    UNION SELECT k FROM jsonb_object_keys(v_without) k
    UNION SELECT k FROM jsonb_object_keys(v_after) k
  ), j AS (
    SELECT COALESCE(v_after->k, v_now->k, v_without->k) AS meta,
           COALESCE((v_now->k->>'value')::numeric, 0) AS n,
           COALESCE((v_without->k->>'value')::numeric, 0) AS w,
           COALESCE((v_after->k->>'value')::numeric, 0) AS a
      FROM keys
  )
  SELECT j.meta->>'kind', (j.meta->>'id')::uuid, (j.meta->>'month')::date, j.meta->>'label',
         j.n, j.w, j.a,
         (j.meta->>'allocated')::numeric, (j.meta->>'income')::boolean, (j.meta->>'closed')::boolean,
         (j.meta->>'sweep_target')::uuid, NULL::text
    FROM j
   WHERE abs(j.a - j.n) >= 0.005 OR abs(j.a - j.w) >= 0.005;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_transaction_impact(jsonb, uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_transaction_impact(jsonb, uuid[]) TO authenticated;
