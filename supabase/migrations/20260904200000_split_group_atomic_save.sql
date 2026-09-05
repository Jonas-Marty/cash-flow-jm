-- Split groups: validate at commit time, and save the whole group in one call.
--
-- The old validation was a BEFORE ROW trigger that compared the row being
-- written against one sibling as it stood *before* the statement. Editing a
-- split therefore had to keep user_id / source_account_id / occurred_on / type
-- constant: the client writes one slice per request, so the first slice always
-- disagreed with its still-unchanged siblings and the write was rejected
-- ("split group rows must share user, source_account_id, occurred_on, and
-- type"). Moving a split to another date or account was impossible.
--
-- Two changes fix that:
--   1. The check becomes a DEFERRABLE INITIALLY DEFERRED constraint trigger
--      that validates the *final* state of the group at commit, so slices may
--      disagree mid-transaction.
--   2. save_split_group() applies an entire edited group — updates, inserts and
--      removals — inside a single transaction, so there is no half-saved group
--      if one row fails.

-- ───────────────────────── 1. Deferred group validation ─────────────────────
CREATE OR REPLACE FUNCTION public.validate_transaction_split_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_group uuid := NEW.split_group_id;
  v_variants int;
BEGIN
  IF v_group IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
     WHERE split_group_id = v_group AND type = 'transfer'
  ) THEN
    RAISE EXCEPTION 'transfers cannot be part of a split group';
  END IF;

  -- Distinct counting also catches NULLs, which the old `<>` comparison let
  -- through (NULL <> x is NULL, never true).
  SELECT count(*) INTO v_variants
    FROM (
      SELECT DISTINCT user_id, source_account_id, occurred_on, type
        FROM public.transactions
       WHERE split_group_id = v_group
    ) s;

  IF v_variants > 1 THEN
    RAISE EXCEPTION 'split group rows must share user, source_account_id, occurred_on, and type';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_split_group ON public.transactions;
CREATE CONSTRAINT TRIGGER trg_validate_transaction_split_group
AFTER INSERT OR UPDATE OF split_group_id, source_account_id, occurred_on, type, user_id
ON public.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_transaction_split_group();

-- ───────────────────────── 2. Atomic group save ─────────────────────────────
-- p_slices is an ordered JSON array of
--   { id, amount, description, note, category_id,
--     is_reimbursable, reimbursable_counterparty, reimbursable_reason }
-- where `id` is the existing transaction (update) or null (new slice).
-- Rows currently in the group that are absent from p_slices are deleted.
-- p_location carries the columns produced by locationToColumns() in the app.
-- Returns the resulting transaction ids, in slice order.
CREATE OR REPLACE FUNCTION public.save_split_group(
  p_group_id uuid,
  p_occurred_on date,
  p_type text,
  p_source_account_id uuid,
  p_slices jsonb,
  p_location jsonb DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type public.transaction_type;
  v_count int;
  v_idx int;
  s jsonb;
  v_id uuid;
  v_amount numeric;
  v_category uuid;
  v_ids uuid[] := '{}';
  v_lat numeric := NULLIF(p_location->>'latitude', '')::numeric;
  v_lng numeric := NULLIF(p_location->>'longitude', '')::numeric;
  v_acc numeric := NULLIF(p_location->>'location_accuracy_m', '')::numeric;
  v_label text := p_location->>'location_label';
  v_source text := p_location->>'location_source';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'a split group id is required';
  END IF;
  IF jsonb_typeof(p_slices) <> 'array' THEN
    RAISE EXCEPTION 'p_slices must be a JSON array';
  END IF;
  v_count := jsonb_array_length(p_slices);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'a split group needs at least 2 slices';
  END IF;

  v_type := p_type::public.transaction_type;
  IF v_type = 'transfer' THEN
    RAISE EXCEPTION 'transfers cannot be part of a split group';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE id = p_source_account_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'unknown source account';
  END IF;

  FOR v_idx IN 0 .. v_count - 1 LOOP
    s := p_slices -> v_idx;
    v_id := NULLIF(s ->> 'id', '')::uuid;
    v_amount := NULLIF(s ->> 'amount', '')::numeric;
    v_category := NULLIF(s ->> 'category_id', '')::uuid;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'every slice needs an amount greater than zero';
    END IF;
    IF v_category IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories WHERE id = v_category AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'unknown category';
    END IF;

    IF v_id IS NOT NULL THEN
      -- Only the caller's own rows, and only ones that already belong to this
      -- group or to no group at all (the "turn a single transaction into a
      -- split" case). Anything else would silently steal a row.
      UPDATE public.transactions t
         SET occurred_on = p_occurred_on,
             amount = v_amount,
             description = NULLIF(s ->> 'description', ''),
             note = NULLIF(s ->> 'note', ''),
             type = v_type,
             source_account_id = p_source_account_id,
             destination_account_id = NULL,
             category_id = v_category,
             split_group_id = p_group_id,
             is_reimbursable = COALESCE((s ->> 'is_reimbursable')::boolean, false),
             reimbursable_counterparty = NULLIF(s ->> 'reimbursable_counterparty', ''),
             reimbursable_reason = NULLIF(s ->> 'reimbursable_reason', ''),
             latitude = v_lat,
             longitude = v_lng,
             location_accuracy_m = v_acc,
             location_label = v_label,
             location_source = v_source
       WHERE t.id = v_id
         AND t.user_id = v_uid
         AND (t.split_group_id = p_group_id OR t.split_group_id IS NULL);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'transaction % is not part of this split group', v_id;
      END IF;
    ELSE
      INSERT INTO public.transactions
        (user_id, occurred_on, amount, description, note, type,
         source_account_id, destination_account_id, category_id, split_group_id,
         is_reimbursable, reimbursable_counterparty, reimbursable_reason,
         latitude, longitude, location_accuracy_m, location_label, location_source)
      VALUES
        (v_uid, p_occurred_on, v_amount, NULLIF(s ->> 'description', ''),
         NULLIF(s ->> 'note', ''), v_type,
         p_source_account_id, NULL, v_category, p_group_id,
         COALESCE((s ->> 'is_reimbursable')::boolean, false),
         NULLIF(s ->> 'reimbursable_counterparty', ''),
         NULLIF(s ->> 'reimbursable_reason', ''),
         v_lat, v_lng, v_acc, v_label, v_source)
      RETURNING id INTO v_id;
    END IF;

    v_ids := v_ids || v_id;
  END LOOP;

  -- Slices the user removed from the group.
  DELETE FROM public.transactions
   WHERE split_group_id = p_group_id
     AND user_id = v_uid
     AND NOT (id = ANY (v_ids));

  -- Report a violation here, with a usable message, instead of at COMMIT.
  SET CONSTRAINTS public.trg_validate_transaction_split_group IMMEDIATE;

  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_split_group(uuid, date, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_split_group(uuid, date, text, uuid, jsonb, jsonb) TO authenticated;
