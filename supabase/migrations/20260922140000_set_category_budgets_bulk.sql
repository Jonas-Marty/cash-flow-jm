-- Fill-right and copy-a-column are one decision each, not twelve.
--
-- Sending them as N separate set_category_budget calls would mean a partial failure
-- leaves the grid half-applied with no way to tell how far it got, and would bury the
-- audit log under one row per cell — which defeats the point of auditing retroactive
-- edits at all, since nobody reads forty entries.
--
-- So: one transaction, one audit entry naming the affected span. The per-cell guards
-- are the same ones set_category_budget applies, because bypassing them through the
-- bulk path is exactly the loophole worth not opening.
--
-- Deliberately *no* scope argument. In the grid you pick the cells you mean; the
-- "and later" idea is expressed by which cells the caller sends.
--
-- An edit with a null `amount` *clears* the cell instead of writing it. Undo needs
-- this: a month that had no row was undecided, and restoring it by writing back the
-- value it happened to inherit would quietly decide it. Clearing is the only way back
-- to the state the user actually had.

CREATE OR REPLACE FUNCTION public.set_category_budgets_bulk(p_edits jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_applied   integer := 0;
  v_retro     integer := 0;
  v_min_month date;
  v_max_month date;
  v_cats      uuid[];
  v_edits     jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'set_category_budgets_bulk requires an authenticated user';
  END IF;

  IF jsonb_typeof(p_edits) <> 'array' THEN
    RAISE EXCEPTION 'p_edits must be a JSON array';
  END IF;

  IF jsonb_array_length(p_edits) = 0 THEN
    RETURN 0;
  END IF;

  -- Guard the whole batch before writing any of it: a batch that touches someone
  -- else's envelope, or a scope, is rejected entirely rather than partially applied.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_edits) e
      LEFT JOIN public.categories c
        ON c.id = (e->>'category_id')::uuid AND c.user_id = v_uid
     WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'category not found';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_edits) e
      JOIN public.categories c ON c.id = (e->>'category_id')::uuid
     WHERE c.user_id = v_uid AND c.is_scope
  ) THEN
    RAISE EXCEPTION 'scope envelopes have no monthly budget';
  END IF;

  -- Dedup once into a jsonb value rather than a temp table: a temp table would need
  -- defensive cleanup for a caller that batches two invocations into one transaction,
  -- and the IF EXISTS drop that guards it emits a NOTICE on every single call.
  SELECT jsonb_agg(jsonb_build_object('category_id', d.category_id, 'month', d.month, 'amount', d.amount))
    INTO v_edits
    FROM (
      SELECT DISTINCT ON (category_id, month) category_id, month, amount
        FROM (
          SELECT (e.value->>'category_id')::uuid                       AS category_id,
                 date_trunc('month', (e.value->>'month')::date)::date  AS month,
                 (e.value->>'amount')::numeric                         AS amount,
                 e.ord                                                 AS ord
            FROM jsonb_array_elements(p_edits) WITH ORDINALITY AS e(value, ord)
        ) edits
       -- Last write wins if the same cell appears twice in one batch. ON CONFLICT
       -- cannot see a row twice in one statement, so duplicates go before the insert.
       ORDER BY category_id, month, ord DESC
    ) d;

  DELETE FROM public.category_budgets cb
   USING jsonb_to_recordset(v_edits) AS e(category_id uuid, month date, amount numeric)
   WHERE cb.category_id = e.category_id
     AND cb.month = e.month
     AND e.amount IS NULL;

  INSERT INTO public.category_budgets (category_id, month, amount)
  SELECT e.category_id, e.month, e.amount
    FROM jsonb_to_recordset(v_edits) AS e(category_id uuid, month date, amount numeric)
   WHERE e.amount IS NOT NULL
  ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount;

  SELECT count(*)::integer,
         min(e.month),
         max(e.month),
         array_agg(DISTINCT e.category_id),
         count(*) FILTER (WHERE e.month + INTERVAL '1 month' <= CURRENT_DATE)::integer
    INTO v_applied, v_min_month, v_max_month, v_cats, v_retro
    FROM jsonb_to_recordset(v_edits) AS e(category_id uuid, month date, amount numeric);

  IF v_retro > 0 THEN
    PERFORM public.log_audit_event('custom', jsonb_build_object(
      'event',          'budget.bulk_change',
      'cells',          v_applied,
      'elapsed_cells',  v_retro,
      'from_month',     to_char(v_min_month, 'YYYY-MM'),
      'to_month',       to_char(v_max_month, 'YYYY-MM'),
      'categories',     to_jsonb(v_cats)
    ));
  END IF;

  RETURN v_applied;
END;
$function$;

REVOKE ALL     ON FUNCTION public.set_category_budgets_bulk(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_category_budgets_bulk(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_category_budgets_bulk(jsonb) TO authenticated;
