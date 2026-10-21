-- A closed scope holds exactly 0, and anything that would change that reopens it.
--
-- Closing a scope funds it from its funding envelope; reopening it was done in
-- the browser and only removed that funding when it was the undo right after
-- closing. "Wieder öffnen" left it in place, so closing again funded the whole
-- amount a second time (Pfingst Velotour Jura mit FF: spent 73.25, funded
-- 65.25 + 73.25). Editing a scope-close reallocation, or a transaction booked
-- on a closed scope, also left money in it with no way back to 0.
--
-- 1. category_reallocations.closes_scope marks the reallocation a close made.
--    Existing ones: every reallocation into or out of a closed scope.
-- 2. close_scope() brings the scope's balance to exactly 0 against its funding
--    envelope (either direction, so money reallocated into a scope goes back
--    too) and closes it. reopen_scope() clears closed_at and removes every
--    reallocation that closed it, so the money is back in the funding envelope
--    and the next close settles once, at the new total.
-- 3. A close reallocation cannot be edited or deleted while its scope is
--    closed: reopen the scope instead.
-- 4. Adding, deleting or changing the money of a transaction on a closed scope
--    (amount, type, category) reopens that scope the same way. Description,
--    date and note do not, because they do not change what the scope holds.

ALTER TABLE public.category_reallocations
  ADD COLUMN IF NOT EXISTS closes_scope boolean NOT NULL DEFAULT false;

-- Existing ones are recognised by what they touch, not by their note (a free
-- text the user can edit or write in any language): every reallocation into or
-- out of a scope that is closed. Closed scopes only ever received money by
-- being closed (dev and prod have no other reallocation into a scope), and new
-- ones into a closed scope are refused since 20261021140000.
UPDATE public.category_reallocations r
   SET closes_scope = true
  FROM public.categories c
 WHERE c.id IN (r.to_category_id, r.from_category_id)
   AND c.is_scope AND c.closed_at IS NOT NULL
   AND r.closes_scope = false;

-- What a scope holds over all time: its transactions and reallocations. Scopes
-- get no monthly allocation and no opening balance (category_savings_balance
-- excludes both), so this is its cumulative balance without needing auth.uid(),
-- which a trigger fired by a server function may not have.
CREATE OR REPLACE FUNCTION public.scope_balance(p_scope_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount
                                   WHEN t.type = 'expense' THEN -t.amount ELSE 0 END)
                     FROM public.transactions t WHERE t.category_id = p_scope_id), 0)
       + COALESCE((SELECT SUM(r.amount) FROM public.category_reallocations r
                    WHERE r.to_category_id = p_scope_id), 0)
       - COALESCE((SELECT SUM(r.amount) FROM public.category_reallocations r
                    WHERE r.from_category_id = p_scope_id), 0);
$function$;

-- Reopen without permission checks; callers check ownership.
CREATE OR REPLACE FUNCTION public.reopen_scope_internal(p_scope_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Open first: the close reallocations may only be removed from an open scope.
  UPDATE public.categories SET closed_at = NULL WHERE id = p_scope_id AND closed_at IS NOT NULL;
  DELETE FROM public.category_reallocations
   WHERE closes_scope AND (to_category_id = p_scope_id OR from_category_id = p_scope_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_scope_internal(uuid) FROM public, anon, authenticated;

-- SECURITY DEFINER to call reopen_scope_internal, which is not granted to
-- users; the ownership check below is what keeps it to the user's own scopes.
CREATE OR REPLACE FUNCTION public.reopen_scope(p_scope_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.categories
                  WHERE id = p_scope_id AND user_id = auth.uid() AND is_scope) THEN
    RAISE EXCEPTION 'scope not found';
  END IF;
  PERFORM public.reopen_scope_internal(p_scope_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_scope(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reopen_scope(uuid) TO authenticated;

-- p_note is the label shown on the reallocation, in the user's language; the
-- logic never reads it (closes_scope does that job).
CREATE OR REPLACE FUNCTION public.close_scope(p_scope_id uuid, p_note text DEFAULT NULL)
 RETURNS TABLE(reallocation_id uuid, amount numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope public.categories%ROWTYPE;
  v_balance numeric;
  v_id uuid := NULL;
BEGIN
  SELECT * INTO v_scope FROM public.categories
   WHERE id = p_scope_id AND user_id = auth.uid() AND is_scope;
  IF NOT FOUND THEN RAISE EXCEPTION 'scope not found'; END IF;
  IF v_scope.closed_at IS NOT NULL THEN RAISE EXCEPTION 'scope already closed'; END IF;

  v_balance := round(public.scope_balance(p_scope_id), 2);
  IF v_balance <> 0 AND v_scope.funding_category_id IS NOT NULL THEN
    -- Spent more than it got: the funding envelope pays the rest. Got more than
    -- it spent: the rest goes back.
    INSERT INTO public.category_reallocations
      (user_id, from_category_id, to_category_id, amount, occurred_on, note, closes_scope)
    VALUES (v_scope.user_id,
            CASE WHEN v_balance < 0 THEN v_scope.funding_category_id ELSE p_scope_id END,
            CASE WHEN v_balance < 0 THEN p_scope_id ELSE v_scope.funding_category_id END,
            abs(v_balance), CURRENT_DATE, COALESCE(NULLIF(trim(p_note), ''), 'Scope close'), true)
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.categories SET closed_at = now() WHERE id = p_scope_id;
  reallocation_id := v_id;
  amount := abs(v_balance);
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.close_scope(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.close_scope(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_scope_close_reallocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.closes_scope AND EXISTS (
       SELECT 1 FROM public.categories c
        WHERE c.id IN (OLD.to_category_id, OLD.from_category_id)
          AND c.is_scope AND c.closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'this reallocation closed a scope: reopen the scope to change it';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_scope_close_reallocation ON public.category_reallocations;
CREATE TRIGGER trg_guard_scope_close_reallocation
  BEFORE UPDATE OR DELETE ON public.category_reallocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_scope_close_reallocation();

CREATE OR REPLACE FUNCTION public.reopen_closed_scope_on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
    RETURN NULL;
  END IF;
  FOR v_id IN
    SELECT c.id FROM public.categories c
     WHERE c.is_scope AND c.closed_at IS NOT NULL
       AND c.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.category_id END,
                    CASE WHEN TG_OP <> 'DELETE' THEN NEW.category_id END)
  LOOP
    PERFORM public.reopen_scope_internal(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reopen_closed_scope_on_change ON public.transactions;
CREATE TRIGGER trg_reopen_closed_scope_on_change
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.reopen_closed_scope_on_change();
