-- Distribute the accounts' opening money over the budgets in one step.
--
-- Settings had an opening-balance field per rolling budget, saved on blur, so
-- a redistribution went through states where the total was wrong, and nothing
-- stopped handing out more than the accounts ever held. The popup now sends
-- every amount at once, and this saves them together:
--   * only rolling budgets that are not scopes may hold one (scopes are funded
--     when they close; a monthly budget hands its rest on every month);
--   * together they may not exceed what all accounts started with, archived
--     accounts included, the same sum envelope_reconciliation counts;
--   * negative amounts are fine: a budget can start with a deficit.
--
-- An archived budget whose opening balance changes is reopened. Archiving
-- moved its balance on (or found it at 0), so a changed opening balance would
-- leave money in a budget nobody sees. Reopening unarchives it and removes the
-- move archiving made, so the money is back in the budget and archiving again
-- asks where the remainder goes, with the right amount. The move is recognised
-- by a column archive_savings_envelope sets, not by its note.
--
-- p_balances: [{"category_id": "...", "amount": 1000}, ...]; budgets left out
-- keep their opening balance. Returns the budgets it reopened.

ALTER TABLE public.category_reallocations
  ADD COLUMN IF NOT EXISTS archives_category boolean NOT NULL DEFAULT false;

-- Moves made by archiving before the column existed. The note is the one this
-- function has always written, never one a person typed.
UPDATE public.category_reallocations r
   SET archives_category = true
  FROM public.categories c
 WHERE c.archived
   AND c.id IN (r.from_category_id, r.to_category_id)
   AND r.note LIKE 'Auto-move on archive%'
   AND NOT r.archives_category;

CREATE OR REPLACE FUNCTION public.archive_savings_envelope(p_id uuid, p_move_remaining_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_balance numeric;
  v_rolls_over boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT rolls_over INTO v_rolls_over FROM public.categories WHERE id = p_id AND user_id = v_uid;
  IF v_rolls_over IS NOT TRUE THEN
    RAISE EXCEPTION 'category is not a savings envelope';
  END IF;

  SELECT cumulative_balance INTO v_balance
    FROM public.category_savings_balance(CURRENT_DATE)
   WHERE category_id = p_id;

  IF v_balance IS NULL THEN v_balance := 0; END IF;

  IF v_balance <> 0 THEN
    IF p_move_remaining_to IS NULL THEN
      RAISE EXCEPTION 'a target savings envelope is required to absorb the remaining balance';
    END IF;
    IF v_balance > 0 THEN
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note, archives_category)
      VALUES (v_uid, p_id, p_move_remaining_to, v_balance, CURRENT_DATE, 'Auto-move on archive', true);
    ELSE
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note, archives_category)
      VALUES (v_uid, p_move_remaining_to, p_id, -v_balance, CURRENT_DATE, 'Auto-move on archive (cover deficit)', true);
    END IF;
  END IF;

  UPDATE public.categories SET archived = true WHERE id = p_id AND user_id = v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_opening_balances(p_balances jsonb)
 RETURNS TABLE(reopened_id uuid)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_amounts numeric[];
  v_accounts numeric;
  v_total numeric;
  v_bad text;
  v_reopen uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  IF jsonb_typeof(COALESCE(p_balances, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'balances must be a list';
  END IF;

  SELECT COALESCE(array_agg(category_id), '{}'), COALESCE(array_agg(amount), '{}')
    INTO v_ids, v_amounts
    FROM (SELECT x.category_id, round(COALESCE(x.amount, 0), 2) AS amount
            FROM jsonb_to_recordset(COALESCE(p_balances, '[]'::jsonb)) AS x(category_id uuid, amount numeric)
           WHERE x.category_id IS NOT NULL) w;

  IF cardinality(v_ids) <> (SELECT count(DISTINCT i) FROM unnest(v_ids) i) THEN
    RAISE EXCEPTION 'a budget appears twice';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(v_ids) i
              WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = i AND c.user_id = v_uid)) THEN
    RAISE EXCEPTION 'budget not found';
  END IF;

  SELECT string_agg(c.name, ', ') INTO v_bad
    FROM unnest(v_ids, v_amounts) AS w(category_id, amount)
    JOIN public.categories c ON c.id = w.category_id
   WHERE (NOT c.rolls_over OR c.is_scope) AND w.amount <> 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'only budgets that roll over and are not scopes hold an opening balance: %', v_bad;
  END IF;

  -- The total after saving, counted like envelope_reconciliation counts it.
  SELECT COALESCE(SUM(a.opening_balance), 0) INTO v_accounts
    FROM public.accounts a WHERE a.user_id = v_uid;
  SELECT COALESCE(SUM(COALESCE(w.amount, c.opening_balance)), 0) INTO v_total
    FROM public.categories c
    LEFT JOIN unnest(v_ids, v_amounts) AS w(category_id, amount) ON w.category_id = c.id
   WHERE c.user_id = v_uid AND c.rolls_over AND NOT c.is_scope;
  IF v_total > v_accounts + 0.005 THEN
    RAISE EXCEPTION 'the budgets would start with %, more than the accounts held (%)', v_total, v_accounts;
  END IF;

  SELECT COALESCE(array_agg(c.id), '{}') INTO v_reopen
    FROM unnest(v_ids, v_amounts) AS w(category_id, amount)
    JOIN public.categories c ON c.id = w.category_id
   WHERE c.archived AND abs(c.opening_balance - w.amount) >= 0.005;

  UPDATE public.categories SET archived = false
   WHERE id = ANY (v_reopen) AND user_id = v_uid;
  DELETE FROM public.category_reallocations r
   WHERE r.user_id = v_uid AND r.archives_category
     AND (r.from_category_id = ANY (v_reopen) OR r.to_category_id = ANY (v_reopen));

  UPDATE public.categories c
     SET opening_balance = w.amount
    FROM unnest(v_ids, v_amounts) AS w(category_id, amount)
   WHERE c.id = w.category_id AND c.user_id = v_uid
     AND abs(c.opening_balance - w.amount) >= 0.005;

  RETURN QUERY SELECT unnest(v_reopen);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_opening_balances(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_opening_balances(jsonb) TO authenticated;
