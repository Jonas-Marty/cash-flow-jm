-- What would saving this change? Asked of the database, not re-derived.
--
-- The Auswirkung card in the transaction form computed its numbers in the
-- browser, a second copy of rules that live here: it missed what a transfer's
-- difference does to a budget, what a booking in a month that is already over
-- does to the sweep target, and what an uncategorised booking does to
-- "Nicht zugeordnet". Every new rule would have needed the same copy.
--
-- preview_transaction_change() applies the change for real inside a block that
-- is always rolled back, with every trigger firing as it would on save, and
-- returns what differs before and after:
--
--   account      account_balance()
--   envelope     category_savings_balance() for budgets that roll over (scopes
--                included), as of the later of today and the change's dates
--   month        a monthly budget's month in the change: left for expense
--                budgets (allocated - spent), received for income budgets
--   unallocated  envelope_reconciliation().unallocated
--
-- p_ops is a list of operations, as the form would save them:
--   {"op": "insert", "row": {...}}           a new transaction
--   {"op": "update", "id": "...", "row": {...}}  only the keys given change
--   {"op": "delete", "id": "..."}
-- Rows take the columns the form writes: type, amount, destination_amount,
-- source_account_id, destination_account_id, category_id, occurred_on,
-- description, difference_category_id, is_reimbursable.
--
-- Nothing persists: the rollback also takes back audit rows, tag links and any
-- trigger effect, and no trigger on transactions reaches outside the database.
-- A change the database would refuse comes back as one row with kind 'error'.
-- It runs as the caller, so row security limits it to the caller's own data.

CREATE OR REPLACE FUNCTION public.preview_snapshot(p_as_of date, p_months date[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
    SELECT 'month:' || r.category_id || ':' || m.month,
           jsonb_build_object('kind', 'month', 'id', r.category_id, 'month', m.month,
                              'income', r.kind = 'income', 'allocated', r.allocated,
                              'value', CASE WHEN r.kind = 'income' THEN r.spent_or_received
                                            ELSE r.allocated - r.spent_or_received END)
      FROM unnest(p_months) AS m(month)
      CROSS JOIN LATERAL public.category_month_spending(m.month) r
     WHERE NOT r.rolls_over AND NOT r.is_scope
    UNION ALL
    SELECT 'unallocated',
           jsonb_build_object('kind', 'unallocated', 'value', e.unallocated)
      FROM public.envelope_reconciliation(p_as_of) e
  ) s;
$function$;

REVOKE ALL ON FUNCTION public.preview_snapshot(date, date[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_snapshot(date, date[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_transaction_change(p_ops jsonb)
 RETURNS TABLE(kind text, ref_id uuid, month date, before numeric, after numeric, allocated numeric, income boolean, error text)
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
  v_before jsonb;
  v_after jsonb;
  v_error text := NULL;
  r public.transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(p_ops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_ops) = 0 THEN RETURN; END IF;

  -- Every date the change touches: new dates, and the current dates of the rows
  -- it updates or deletes (moving a booking out of a month changes that month).
  SELECT array_agg(DISTINCT d) INTO v_dates FROM (
    SELECT (o->'row'->>'occurred_on')::date AS d FROM jsonb_array_elements(p_ops) o
     WHERE o->'row' ? 'occurred_on'
    UNION
    SELECT t.occurred_on FROM jsonb_array_elements(p_ops) o
      JOIN public.transactions t ON t.id = (o->>'id')::uuid
     WHERE o->>'op' IN ('update', 'delete')
    UNION
    SELECT CURRENT_DATE FROM jsonb_array_elements(p_ops) o
     WHERE o->>'op' = 'insert' AND NOT (o->'row' ? 'occurred_on')
  ) x WHERE d IS NOT NULL;
  v_dates := COALESCE(v_dates, ARRAY[CURRENT_DATE]);
  SELECT array_agg(DISTINCT date_trunc('month', d)::date) INTO v_months FROM unnest(v_dates) d;
  SELECT GREATEST(CURRENT_DATE, MAX(d)) INTO v_as_of FROM unnest(v_dates) d;

  v_before := public.preview_snapshot(v_as_of, v_months);

  BEGIN
    FOR v_op IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
      v_row := COALESCE(v_op->'row', '{}'::jsonb);
      r := jsonb_populate_record(NULL::public.transactions, v_row);
      IF v_op->>'op' = 'insert' THEN
        INSERT INTO public.transactions
          (user_id, type, amount, destination_amount, source_account_id, destination_account_id,
           category_id, occurred_on, description, difference_category_id, is_reimbursable)
        VALUES
          (v_uid, r.type, r.amount, r.destination_amount, r.source_account_id, r.destination_account_id,
           r.category_id, COALESCE(r.occurred_on, CURRENT_DATE), r.description, r.difference_category_id,
           COALESCE(r.is_reimbursable, false));
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
          is_reimbursable = CASE WHEN v_row ? 'is_reimbursable' THEN COALESCE(r.is_reimbursable, false) ELSE t.is_reimbursable END
         WHERE t.id = (v_op->>'id')::uuid AND t.user_id = v_uid;
      ELSIF v_op->>'op' = 'delete' THEN
        DELETE FROM public.transactions WHERE id = (v_op->>'id')::uuid AND user_id = v_uid;
      ELSE
        RAISE EXCEPTION 'unknown preview operation %', v_op->>'op';
      END IF;
    END LOOP;

    v_after := public.preview_snapshot(v_as_of, v_months);
    -- Undo everything above. Only this exact code is the planned way out.
    RAISE EXCEPTION 'preview rolled back' USING ERRCODE = 'P0099';
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN NULL;
    WHEN OTHERS THEN v_error := SQLERRM;
  END;

  IF v_error IS NOT NULL THEN
    kind := 'error'; error := v_error;
    RETURN NEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT COALESCE(a.value->>'kind', b.value->>'kind'),
         (COALESCE(a.value, b.value)->>'id')::uuid,
         (COALESCE(a.value, b.value)->>'month')::date,
         COALESCE((b.value->>'value')::numeric, 0),
         COALESCE((a.value->>'value')::numeric, 0),
         (COALESCE(a.value, b.value)->>'allocated')::numeric,
         (COALESCE(a.value, b.value)->>'income')::boolean,
         NULL::text
    FROM jsonb_each(v_before) b
    FULL JOIN jsonb_each(v_after) a ON a.key = b.key
   WHERE abs(COALESCE((a.value->>'value')::numeric, 0) - COALESCE((b.value->>'value')::numeric, 0)) >= 0.005;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_transaction_change(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.preview_transaction_change(jsonb) TO authenticated;
