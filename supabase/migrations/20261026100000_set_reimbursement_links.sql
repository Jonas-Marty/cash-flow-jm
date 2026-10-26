-- Change which reimbursables an income covers, in one step.
--
-- The links were only ever written when an income was created; afterwards the
-- form could neither show nor change them, so a wrong assignment stayed. The
-- edit form now sends the whole list, and this replaces the income's links
-- with it: links no longer in the list are removed, changed amounts updated,
-- new ones added. One function, so a failure leaves the old links in place
-- rather than half of the new ones.
--
-- Rules on top of what the link triggers already check (each link > 0, no more
-- than the settling amount, an original's links no more than the original):
--   * together the links may not claim more than the income itself;
--   * links to a reimbursable that is written off or cancelled stay exactly as
--     they are: the write-off already moved this income, and changing the link
--     behind it would leave the two disagreeing.
--
-- Removing a link fires the existing status recompute, so a reimbursable that
-- is no longer fully covered is 'open' again and shows on the dashboard and
-- under "Offen" (both read reimbursable_status = 'open').
--
-- p_links: [{"original_id": "...", "amount": 12.30}, ...]; an empty list
-- removes every link of the income.

CREATE OR REPLACE FUNCTION public.set_reimbursement_links(p_settling_id uuid, p_links jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_settler public.transactions%ROWTYPE;
  v_total numeric;
  v_ids uuid[];
  v_amounts numeric[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  SELECT * INTO v_settler FROM public.transactions WHERE id = p_settling_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF jsonb_typeof(COALESCE(p_links, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'links must be a list';
  END IF;

  SELECT COALESCE(array_agg(original_id), '{}'), COALESCE(array_agg(amount), '{}')
    INTO v_ids, v_amounts
    FROM (SELECT x.original_id, round(SUM(x.amount), 2) AS amount
            FROM jsonb_to_recordset(COALESCE(p_links, '[]'::jsonb)) AS x(original_id uuid, amount numeric)
           WHERE x.original_id IS NOT NULL AND x.amount > 0
           GROUP BY x.original_id) w;

  SELECT COALESCE(SUM(a), 0) INTO v_total FROM unnest(v_amounts) a;
  IF v_total > v_settler.amount + 0.005 THEN
    RAISE EXCEPTION 'the links would total %, more than this transaction (%)', v_total, v_settler.amount;
  END IF;

  -- Written off or cancelled: their link must come back unchanged, and no new
  -- one may be made.
  IF EXISTS (
    SELECT 1
      FROM public.transactions o
      LEFT JOIN public.transaction_reimbursements l
        ON l.original_transaction_id = o.id AND l.settling_transaction_id = p_settling_id
      LEFT JOIN unnest(v_ids, v_amounts) AS w(original_id, amount) ON w.original_id = o.id
     WHERE o.user_id = v_uid
       AND o.reimbursable_status IN ('written_off', 'cancelled')
       AND (l.id IS NOT NULL OR w.original_id IS NOT NULL)
       AND (l.id IS NULL OR w.original_id IS NULL OR abs(l.amount - w.amount) >= 0.005)
  ) THEN
    RAISE EXCEPTION 'a reimbursable that is written off or cancelled keeps its link as it is';
  END IF;

  DELETE FROM public.transaction_reimbursements l
   WHERE l.settling_transaction_id = p_settling_id
     AND NOT (l.original_transaction_id = ANY (v_ids));

  UPDATE public.transaction_reimbursements l
     SET amount = w.amount
    FROM unnest(v_ids, v_amounts) AS w(original_id, amount)
   WHERE l.settling_transaction_id = p_settling_id
     AND l.original_transaction_id = w.original_id
     AND abs(l.amount - w.amount) >= 0.005;

  INSERT INTO public.transaction_reimbursements (user_id, original_transaction_id, settling_transaction_id, amount)
  SELECT v_uid, w.original_id, p_settling_id, w.amount
    FROM unnest(v_ids, v_amounts) AS w(original_id, amount)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.transaction_reimbursements l
      WHERE l.settling_transaction_id = p_settling_id AND l.original_transaction_id = w.original_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_reimbursement_links(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_reimbursement_links(uuid, jsonb) TO authenticated;
