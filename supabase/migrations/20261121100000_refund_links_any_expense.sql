-- An income can repay any expense, not only one already marked reimbursable.
--
-- You often learn only when the money arrives that an expense will be paid
-- back. The income form now searches every expense; picking one marks it
-- reimbursable and links it in the same step, together with what the user
-- decided about the rest of it and about the budget:
--
--   rest of the expense   still coming -> it stays open
--                         my share     -> write it off to a category, or split
--                                         the expense into "my share" (that
--                                         category) and a reimbursable part
--                                         without a category
--   refund in full        remove the expense's category (default), or book the
--                         income to a category (the income's own row, set by
--                         the app; nothing changes on the expense)
--
-- Unlinking undoes the mark: an expense this flow marked, with no link left
-- and not written off or cancelled, is an ordinary expense again and gets back
-- the category it had.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reimbursable_flagged_by_link boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reimbursable_prior_category_id uuid;

COMMENT ON COLUMN public.transactions.reimbursable_flagged_by_link IS
  'Marked reimbursable by an income that repays it; the mark goes again when no link is left.';
COMMENT ON COLUMN public.transactions.reimbursable_prior_category_id IS
  'Category the expense had before a repayment removed it; restored when the mark goes.';

-- Clearing the flag clears the markers too.
CREATE OR REPLACE FUNCTION public.default_reimbursable_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_reimbursable = true AND NEW.reimbursable_status IS NULL THEN
    NEW.reimbursable_status := 'open';
  END IF;
  IF NEW.is_reimbursable = false THEN
    NEW.reimbursable_status := NULL;
    NEW.reimbursable_counterparty := NULL;
    NEW.reimbursable_reason := NULL;
    NEW.reimbursable_cancel_reason := NULL;
    NEW.reimbursable_writeoff_category_id := NULL;
    NEW.reimbursable_writeoff_transaction_id := NULL;
    NEW.reimbursable_flagged_by_link := false;
    NEW.reimbursable_prior_category_id := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- An expense marked by a repayment, with no repayment left: ordinary again.
-- Written off or cancelled is an outcome the user chose, so it stays.
CREATE OR REPLACE FUNCTION public.release_link_flag(p_orig uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.transactions t
     SET is_reimbursable = false,
         category_id = COALESCE(t.category_id, t.reimbursable_prior_category_id)
   WHERE t.id = p_orig
     AND (auth.uid() IS NULL OR t.user_id = auth.uid())
     AND t.reimbursable_flagged_by_link
     AND t.reimbursable_status IN ('open', 'settled')
     AND NOT EXISTS (
       SELECT 1 FROM public.transaction_reimbursements l WHERE l.original_transaction_id = p_orig);
END;
$function$;

-- Called by the link trigger, which runs as the signed-in user.
REVOKE ALL ON FUNCTION public.release_link_flag(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_link_flag(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.after_reimbursement_link_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_reimbursable_status(OLD.original_transaction_id);
    PERFORM public.release_link_flag(OLD.original_transaction_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_reimbursable_status(NEW.original_transaction_id);
    IF TG_OP = 'UPDATE' AND OLD.original_transaction_id <> NEW.original_transaction_id THEN
      PERFORM public.recompute_reimbursable_status(OLD.original_transaction_id);
      PERFORM public.release_link_flag(OLD.original_transaction_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

-- Replace what one income row repays, applying the choices for expenses picked
-- just now. p_links:
--   [{ "original_id": "...", "amount": 60.00,
--      "decision": { "rest": "coming" | "mine",
--                    "how": "writeoff" | "split",          -- when rest = mine
--                    "budget": "remove" | "credit" | "none",
--                    "category_id": "..." } }]              -- my share's category
-- An entry without "decision" is a link the income already had; only its
-- amount is taken. Links missing from the list are removed (see
-- set_reimbursement_links, which this ends with).
CREATE OR REPLACE FUNCTION public.apply_refund_links(
  p_settling_id uuid,
  p_links jsonb,
  p_counterparty text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settler public.transactions%ROWTYPE;
  v_orig public.transactions%ROWTYPE;
  v_currency text;
  v_cp text := NULLIF(btrim(COALESCE(p_counterparty, '')), '');
  l jsonb;
  d jsonb;
  v_amount numeric;
  v_other numeric;
  v_open numeric;
  v_rest numeric;
  v_rest_mode text;
  v_how text;
  v_budget text;
  v_cat uuid;
  v_group uuid;
  v_plain jsonb := '[]'::jsonb;
  v_writeoffs jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_settler FROM public.transactions WHERE id = p_settling_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF jsonb_typeof(COALESCE(p_links, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'links must be a list';
  END IF;
  SELECT currency_code INTO v_currency FROM public.accounts WHERE id = v_settler.source_account_id;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_links, '[]'::jsonb)) LOOP
    v_amount := round(NULLIF(l->>'amount', '')::numeric, 2);
    d := l->'decision';
    IF d IS NULL OR jsonb_typeof(d) <> 'object' THEN
      v_plain := v_plain || jsonb_build_array(jsonb_build_object('original_id', l->>'original_id', 'amount', v_amount));
      CONTINUE;
    END IF;

    IF v_settler.type <> 'income' THEN
      RAISE EXCEPTION 'only an income can repay an expense';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'every repaid amount must be greater than zero';
    END IF;
    SELECT * INTO v_orig FROM public.transactions
     WHERE id = NULLIF(l->>'original_id', '')::uuid AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'expense not found'; END IF;
    IF v_orig.type <> 'expense' THEN
      RAISE EXCEPTION 'only an expense can be repaid this way';
    END IF;
    IF (SELECT currency_code FROM public.accounts WHERE id = v_orig.source_account_id) IS DISTINCT FROM v_currency THEN
      RAISE EXCEPTION 'the expense is in another currency than this income';
    END IF;
    IF v_orig.is_reimbursable AND v_orig.reimbursable_status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'this expense is already settled, written off or cancelled';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_other
      FROM public.transaction_reimbursements
     WHERE original_transaction_id = v_orig.id AND settling_transaction_id <> p_settling_id;
    v_open := v_orig.amount - v_other;
    IF v_amount > v_open + 0.005 THEN
      RAISE EXCEPTION 'more than is open on this expense (%)', v_open;
    END IF;
    v_rest := round(v_open - v_amount, 2);
    v_rest_mode := COALESCE(d->>'rest', 'coming');
    v_how := COALESCE(d->>'how', 'writeoff');
    v_budget := COALESCE(d->>'budget', 'none');
    v_cat := NULLIF(d->>'category_id', '')::uuid;
    IF v_cat IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories WHERE id = v_cat AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'unknown category';
    END IF;

    -- Reimbursable from now on; the person is taken only where none is named.
    IF NOT v_orig.is_reimbursable THEN
      UPDATE public.transactions
         SET is_reimbursable = true,
             reimbursable_status = 'open',
             reimbursable_counterparty = v_cp,
             reimbursable_flagged_by_link = true
       WHERE id = v_orig.id;
    ELSIF v_orig.reimbursable_counterparty IS NULL AND v_cp IS NOT NULL THEN
      UPDATE public.transactions SET reimbursable_counterparty = v_cp WHERE id = v_orig.id;
    END IF;

    IF v_rest > 0.005 AND v_rest_mode = 'mine' THEN
      IF v_cat IS NULL THEN
        RAISE EXCEPTION 'choose a category for your share';
      END IF;
      IF v_how = 'split' THEN
        -- The row keeps its id, links and attachments as the reimbursable
        -- part, without a category; your share is a new line of the split.
        v_group := COALESCE(v_orig.split_group_id, gen_random_uuid());
        UPDATE public.transactions
           SET amount = v_orig.amount - v_rest,
               split_group_id = v_group,
               reimbursable_prior_category_id = COALESCE(reimbursable_prior_category_id, category_id),
               category_id = NULL
         WHERE id = v_orig.id;
        INSERT INTO public.transactions
          (user_id, occurred_on, amount, description, note, type, source_account_id,
           category_id, split_group_id, latitude, longitude, location_accuracy_m,
           location_label, location_source)
        VALUES
          (v_uid, v_orig.occurred_on, v_rest, v_orig.description, v_orig.note, 'expense',
           v_orig.source_account_id, v_cat, v_group, v_orig.latitude, v_orig.longitude,
           v_orig.location_accuracy_m, v_orig.location_label, v_orig.location_source);
      ELSE
        -- Written off once the link exists, so the status sticks.
        v_writeoffs := v_writeoffs || jsonb_build_array(jsonb_build_object('id', v_orig.id, 'category_id', v_cat));
      END IF;
    ELSIF v_budget = 'remove' AND v_orig.category_id IS NOT NULL THEN
      UPDATE public.transactions
         SET reimbursable_prior_category_id = category_id,
             category_id = NULL
       WHERE id = v_orig.id;
    END IF;

    v_plain := v_plain || jsonb_build_array(jsonb_build_object('original_id', v_orig.id, 'amount', v_amount));
  END LOOP;

  PERFORM public.set_reimbursement_links(p_settling_id, v_plain);

  -- Writing off: the expense and every repayment that repays only it go to the
  -- one category, so it carries the true net (architecture §3.7). This row's
  -- own category was already set by the app.
  FOR l IN SELECT * FROM jsonb_array_elements(v_writeoffs) LOOP
    v_cat := (l->>'category_id')::uuid;
    UPDATE public.transactions
       SET category_id = v_cat,
           reimbursable_status = 'written_off',
           reimbursable_writeoff_category_id = v_cat,
           note = concat_ws(' ', NULLIF(btrim(COALESCE(note, '')), ''), '#writeoff')
     WHERE id = (l->>'id')::uuid;
    UPDATE public.transactions s
       SET category_id = v_cat
     WHERE s.user_id = v_uid
       AND s.id <> p_settling_id
       AND s.id IN (SELECT settling_transaction_id FROM public.transaction_reimbursements
                     WHERE original_transaction_id = (l->>'id')::uuid)
       AND NOT EXISTS (SELECT 1 FROM public.transaction_reimbursements o
                        WHERE o.settling_transaction_id = s.id
                          AND o.original_transaction_id <> (l->>'id')::uuid);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_refund_links(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_refund_links(uuid, jsonb, text) TO authenticated;
