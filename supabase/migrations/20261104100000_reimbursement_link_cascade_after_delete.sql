-- Deleting a reimbursable that has a repayment link failed.
--
-- trg_cascade_delete_reimbursement_links ran BEFORE DELETE and removed the
-- links where the deleted row is the original. Removing a link fires
-- trg_after_reimbursement_link_change, which recomputes the original's status
-- and so updates the very row being deleted. Postgres then refuses the delete:
-- "tuple to be deleted was already modified by an operation triggered by the
-- current command". It hit the delete button, a split save that drops a linked
-- slice, and the form's preview of a split edit.
--
-- Run AFTER DELETE instead. The row is gone by then, so the recompute for it
-- finds nothing and stops; a settler's originals are still recomputed, by the
-- link trigger, for every link removed here.

CREATE OR REPLACE FUNCTION public.cascade_delete_reimbursement_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transaction_reimbursements
   WHERE settling_transaction_id = OLD.id OR original_transaction_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_delete_reimbursement_links ON public.transactions;
CREATE TRIGGER trg_cascade_delete_reimbursement_links
AFTER DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_reimbursement_links();
