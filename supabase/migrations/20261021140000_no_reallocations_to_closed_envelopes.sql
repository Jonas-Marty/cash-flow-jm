-- No new money moves into or out of an archived envelope or a closed scope.
--
-- Umschichten listed every rolling envelope, closed scopes included, and the
-- database took it. A closed scope is settled (its close funded exactly what
-- it spent) and an archived envelope has handed its balance on, so a later
-- reallocation would reopen either one behind the user's back.
--
-- Only new links are refused: inserting a reallocation that names such an
-- envelope, or pointing an existing one at it. The reallocations that closed a
-- scope or emptied an envelope were made before it closed, and editing their
-- amount, date or note keeps working. Scope close and archive both insert their
-- reallocation first and close afterwards, so they are unaffected.

CREATE OR REPLACE FUNCTION public.validate_category_reallocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_savings boolean;
  v_to_savings boolean;
  v_from_user uuid;
  v_to_user uuid;
  v_from_gone boolean;
  v_to_gone boolean;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'reallocation amount must be greater than zero';
  END IF;
  IF NEW.from_category_id IS NULL AND NEW.to_category_id IS NULL THEN
    RAISE EXCEPTION 'a reallocation needs a source or a target envelope';
  END IF;
  IF NEW.from_category_id = NEW.to_category_id THEN
    RAISE EXCEPTION 'reallocation source and target must differ';
  END IF;

  IF NEW.from_category_id IS NOT NULL THEN
    SELECT rolls_over, user_id, (archived OR closed_at IS NOT NULL)
      INTO v_from_savings, v_from_user, v_from_gone
      FROM public.categories WHERE id = NEW.from_category_id;
    IF v_from_savings IS NOT TRUE THEN
      RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
    END IF;
    IF v_from_user <> NEW.user_id THEN
      RAISE EXCEPTION 'reallocation categories must belong to the same user';
    END IF;
    IF v_from_gone AND (TG_OP = 'INSERT' OR NEW.from_category_id IS DISTINCT FROM OLD.from_category_id) THEN
      RAISE EXCEPTION 'cannot move money out of an archived envelope or a closed scope';
    END IF;
  END IF;
  IF NEW.to_category_id IS NOT NULL THEN
    SELECT rolls_over, user_id, (archived OR closed_at IS NOT NULL)
      INTO v_to_savings, v_to_user, v_to_gone
      FROM public.categories WHERE id = NEW.to_category_id;
    IF v_to_savings IS NOT TRUE THEN
      RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
    END IF;
    IF v_to_user <> NEW.user_id THEN
      RAISE EXCEPTION 'reallocation categories must belong to the same user';
    END IF;
    IF v_to_gone AND (TG_OP = 'INSERT' OR NEW.to_category_id IS DISTINCT FROM OLD.to_category_id) THEN
      RAISE EXCEPTION 'cannot move money into an archived envelope or a closed scope';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
