-- The bulk writer reported what it was asked to do, not what it did.
--
-- Counts came from the edit list, so deleting rows that were already gone still
-- answered "3 cells" and still wrote an audit entry. Clicking the eraser on an empty
-- month three times produced three identical `budget.bulk_change` records describing
-- changes that never happened — which is worse than no audit log, because it invents
-- history.
--
-- Now the counts come from the rows the statements actually touched: deletes that
-- removed something, inserts that created something, and updates whose amount really
-- differed. Nothing changed means no audit entry.

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

  -- One statement so the delete and the upsert share a snapshot. They cannot collide:
  -- each deduplicated cell is either a clear or a write, never both.
  WITH e AS (
    SELECT * FROM jsonb_to_recordset(v_edits) AS x(category_id uuid, month date, amount numeric)
  ),
  del AS (
    DELETE FROM public.category_budgets cb
     USING e
     WHERE cb.category_id = e.category_id
       AND cb.month = e.month
       AND e.amount IS NULL
    RETURNING cb.category_id, cb.month
  ),
  ups AS (
    INSERT INTO public.category_budgets (category_id, month, amount)
    SELECT e.category_id, e.month, e.amount FROM e WHERE e.amount IS NOT NULL
    ON CONFLICT (category_id, month) DO UPDATE
      SET amount = EXCLUDED.amount
      -- Rewriting a row with the value it already holds is not a change, and
      -- counting it as one is how a no-op earned an audit entry.
      WHERE public.category_budgets.amount IS DISTINCT FROM EXCLUDED.amount
    RETURNING category_id, month
  ),
  touched AS (
    SELECT category_id, month FROM del
    UNION ALL
    SELECT category_id, month FROM ups
  )
  SELECT count(*)::integer,
         min(month),
         max(month),
         array_agg(DISTINCT category_id),
         count(*) FILTER (WHERE month + INTERVAL '1 month' <= CURRENT_DATE)::integer
    INTO v_applied, v_min_month, v_max_month, v_cats, v_retro
    FROM touched;

  IF v_applied > 0 AND v_retro > 0 THEN
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
