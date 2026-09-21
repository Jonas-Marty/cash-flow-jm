-- Reimbursement links recorded the *original's* remaining amount instead of what
-- the settling transaction actually paid, so a partial refund flipped the
-- original to 'settled' and the IOU silently left the dashboard while the money
-- never arrived.
--
-- Order matters: repair the existing rows first, then install the guard. Doing
-- it the other way round would let the new guard reject the very UPDATE that
-- fixes the data it is complaining about.

-- 1. A link may never claim more than the settling transaction actually paid.
UPDATE public.transaction_reimbursements l
   SET amount = s.amount
  FROM public.transactions s
 WHERE s.id = l.settling_transaction_id
   AND l.amount > s.amount + 0.005;

-- 2. The links for one original may not add up to more than the original.
--    Walk them oldest-first and clamp each to whatever budget is left.
WITH ranked AS (
  SELECT l.id,
         l.amount,
         o.amount AS orig_amount,
         COALESCE(SUM(l.amount) OVER (
           PARTITION BY l.original_transaction_id
           ORDER BY l.created_at, l.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior
    FROM public.transaction_reimbursements l
    JOIN public.transactions o ON o.id = l.original_transaction_id
),
clamped AS (
  SELECT id, amount, GREATEST(0, LEAST(amount, orig_amount - prior)) AS new_amount
    FROM ranked
)
UPDATE public.transaction_reimbursements l
   SET amount = c.new_amount
  FROM clamped c
 WHERE c.id = l.id
   AND c.new_amount > 0
   AND c.new_amount < l.amount - 0.005;

-- A link clamped all the way to zero carries no information; drop it.
WITH ranked AS (
  SELECT l.id,
         l.amount,
         o.amount AS orig_amount,
         COALESCE(SUM(l.amount) OVER (
           PARTITION BY l.original_transaction_id
           ORDER BY l.created_at, l.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior
    FROM public.transaction_reimbursements l
    JOIN public.transactions o ON o.id = l.original_transaction_id
)
DELETE FROM public.transaction_reimbursements l
 USING ranked r
 WHERE r.id = l.id
   AND GREATEST(0, LEAST(r.amount, r.orig_amount - r.prior)) <= 0;

-- Both statements fire trg_after_reimbursement_link_change, which recomputes
-- reimbursable_status only for the originals actually touched. A blanket
-- recompute would resurrect IOUs the user deliberately marked settled by hand.

-- 3. The guard itself.
CREATE OR REPLACE FUNCTION public.validate_reimbursement_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_orig_user uuid;
  v_sett_user uuid;
  v_orig_is_reimb boolean;
  v_orig_amount numeric;
  v_sett_amount numeric;
  v_other_links numeric;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'reimbursement link amount must be greater than zero';
  END IF;
  IF NEW.original_transaction_id = NEW.settling_transaction_id THEN
    RAISE EXCEPTION 'a transaction cannot reimburse itself';
  END IF;
  SELECT user_id, is_reimbursable, amount
    INTO v_orig_user, v_orig_is_reimb, v_orig_amount
    FROM public.transactions WHERE id = NEW.original_transaction_id;
  SELECT user_id, amount INTO v_sett_user, v_sett_amount
    FROM public.transactions WHERE id = NEW.settling_transaction_id;
  IF v_orig_user IS NULL OR v_sett_user IS NULL THEN
    RAISE EXCEPTION 'transaction not found';
  END IF;
  IF v_orig_user <> NEW.user_id OR v_sett_user <> NEW.user_id THEN
    RAISE EXCEPTION 'reimbursement link transactions must belong to the same user';
  END IF;
  IF v_orig_is_reimb IS NOT TRUE THEN
    RAISE EXCEPTION 'original transaction must be flagged as reimbursable';
  END IF;

  -- A link cannot claim more than the settling transaction actually paid.
  IF NEW.amount > v_sett_amount + 0.005 THEN
    RAISE EXCEPTION 'reimbursement link amount (%) exceeds the settling transaction amount (%)',
      NEW.amount, v_sett_amount;
  END IF;

  -- All links for one original cannot add up to more than the original.
  SELECT COALESCE(SUM(amount), 0) INTO v_other_links
    FROM public.transaction_reimbursements
   WHERE original_transaction_id = NEW.original_transaction_id
     AND (TG_OP = 'INSERT' OR id <> NEW.id);
  IF v_other_links + NEW.amount > v_orig_amount + 0.005 THEN
    RAISE EXCEPTION 'reimbursement links for this transaction would total %, more than the original amount (%)',
      v_other_links + NEW.amount, v_orig_amount;
  END IF;

  RETURN NEW;
END;
$function$;
