-- `is_savings` decided two things at once and named neither: whether an
-- envelope's month-end remainder carries forward, and whether the month's cost
-- is the allocation rather than the spend. Both follow from "does this roll
-- over?", so call it that. It also stops the name colliding with
-- category_groups.kind = 'savings' (taxonomy) and is_scope (one-off events),
-- which is how the three concepts got muddled in the first place.
--
-- Pure rename: no behaviour changes, no number changes. plpgsql bodies are
-- stored as text, so ALTER TABLE ... RENAME COLUMN does not rewrite them and
-- every function referencing the column has to be recreated here, or it breaks
-- at runtime instead. Views store parse trees, so category_savings_balance
-- follows the rename on its own.

ALTER TABLE public.categories RENAME COLUMN is_savings TO rolls_over;

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
    FROM public.category_savings_balance_v2(CURRENT_DATE)
   WHERE category_id = p_id;

  IF v_balance IS NULL THEN v_balance := 0; END IF;

  IF v_balance <> 0 THEN
    IF p_move_remaining_to IS NULL THEN
      RAISE EXCEPTION 'a target savings envelope is required to absorb the remaining balance';
    END IF;
    IF v_balance > 0 THEN
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_id, p_move_remaining_to, v_balance, CURRENT_DATE, 'Auto-move on archive');
    ELSE
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_move_remaining_to, p_id, -v_balance, CURRENT_DATE, 'Auto-move on archive (cover deficit)');
    END IF;
  END IF;

  UPDATE public.categories SET archived = true WHERE id = p_id AND user_id = v_uid;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.block_sweep_target_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categories WHERE sweep_target_category_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot delete: this savings envelope is still used as a sweep target on at least one category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.category_groups WHERE sweep_target_category_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot delete: this savings envelope is still used as a sweep target on at least one group';
  END IF;
  IF EXISTS (SELECT 1 FROM public.settings WHERE default_sweep_category_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot delete: this savings envelope is still used as the default sweep target';
  END IF;
  RETURN OLD;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.category_savings_balance_v2(p_as_of date)
 RETURNS TABLE(category_id uuid, name text, archived boolean, cumulative_balance numeric, month_activity numeric, from_transactions numeric, from_reallocations numeric, from_sweeps numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + INTERVAL '1 month')::date;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH savings AS (
    SELECT c.id, c.name, c.archived
      FROM public.categories c
     WHERE c.user_id = v_uid AND c.rolls_over = true
  ),
  -- transactions credited/debited directly on the savings envelope
  tx AS (
    SELECT t.category_id,
      SUM(CASE
        WHEN t.type = 'income' AND t.occurred_on <= p_as_of THEN t.amount
        WHEN t.type = 'expense' AND t.occurred_on <= p_as_of THEN -t.amount
        ELSE 0 END) AS cum,
      SUM(CASE
        WHEN t.type = 'income' AND t.occurred_on >= v_month_start AND t.occurred_on < v_month_end THEN t.amount
        WHEN t.type = 'expense' AND t.occurred_on >= v_month_start AND t.occurred_on < v_month_end THEN -t.amount
        ELSE 0 END) AS mth
    FROM public.transactions t
    JOIN savings s ON s.id = t.category_id
    WHERE t.user_id = v_uid
    GROUP BY t.category_id
  ),
  -- reallocations
  rin AS (
    SELECT r.to_category_id AS cid,
      SUM(CASE WHEN r.occurred_on <= p_as_of THEN r.amount ELSE 0 END) AS cum,
      SUM(CASE WHEN r.occurred_on >= v_month_start AND r.occurred_on < v_month_end THEN r.amount ELSE 0 END) AS mth
    FROM public.category_reallocations r
    WHERE r.user_id = v_uid
    GROUP BY r.to_category_id
  ),
  rout AS (
    SELECT r.from_category_id AS cid,
      SUM(CASE WHEN r.occurred_on <= p_as_of THEN r.amount ELSE 0 END) AS cum,
      SUM(CASE WHEN r.occurred_on >= v_month_start AND r.occurred_on < v_month_end THEN r.amount ELSE 0 END) AS mth
    FROM public.category_reallocations r
    WHERE r.user_id = v_uid
    GROUP BY r.from_category_id
  ),
  -- sweeps from non-savings expense envelopes; resolve target per category->group->settings default
  -- We sweep only fully-elapsed months: month_end <= p_as_of (so partial current month not double-counted by reconciliation)
  default_target AS (
    SELECT default_sweep_category_id AS tgt FROM public.settings WHERE user_id = v_uid LIMIT 1
  ),
  -- All months that have either an allocation or activity for any non-savings env, up to p_as_of
  -- For each non-savings envelope we walk over its category_budgets (which ensure_month_budgets seeds).
  per_env_months AS (
    SELECT cb.category_id, cb.month, cb.amount AS allocated,
           COALESCE(c.sweep_target_category_id, g.sweep_target_category_id, (SELECT tgt FROM default_target)) AS target_cid
      FROM public.category_budgets cb
      JOIN public.categories c ON c.id = cb.category_id
      LEFT JOIN public.category_groups g ON g.id = c.group_id
     WHERE c.user_id = v_uid
       AND c.rolls_over = false
       AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
       AND cb.month + INTERVAL '1 month' <= p_as_of  -- only fully-elapsed months
  ),
  per_env_spent AS (
    SELECT pem.category_id, pem.month, pem.allocated, pem.target_cid,
      COALESCE((
        SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                        WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
        FROM public.transactions t
        WHERE t.category_id = pem.category_id
          AND t.user_id = v_uid
          AND t.occurred_on >= pem.month
          AND t.occurred_on < (pem.month + INTERVAL '1 month')
      ), 0) AS spent
    FROM per_env_months pem
  ),
  sweeps AS (
    SELECT target_cid AS cid,
           SUM(allocated - spent) AS cum
    FROM per_env_spent
    WHERE target_cid IS NOT NULL
    GROUP BY target_cid
  )
  SELECT
    s.id, s.name, s.archived,
    COALESCE(tx.cum, 0) + COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) + COALESCE(sweeps.cum, 0) AS cumulative_balance,
    COALESCE(tx.mth, 0) + COALESCE(rin.mth, 0) - COALESCE(rout.mth, 0) AS month_activity,
    COALESCE(tx.cum, 0) AS from_transactions,
    COALESCE(rin.cum, 0) - COALESCE(rout.cum, 0) AS from_reallocations,
    COALESCE(sweeps.cum, 0) AS from_sweeps
  FROM savings s
  LEFT JOIN tx ON tx.category_id = s.id
  LEFT JOIN rin ON rin.cid = s.id
  LEFT JOIN rout ON rout.cid = s.id
  LEFT JOIN sweeps ON sweeps.cid = s.id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.cleanup_budgets_on_savings_flip()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rolls_over = true AND COALESCE(OLD.rolls_over, false) = false THEN
    DELETE FROM public.category_budgets WHERE category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.ensure_month_budgets(p_month date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  INSERT INTO public.category_budgets (category_id, month, amount)
  SELECT c.id, v_month,
    COALESCE(
      (SELECT cb.amount FROM public.category_budgets cb
        WHERE cb.category_id = c.id AND cb.month < v_month
        ORDER BY cb.month DESC LIMIT 1),
      c.allocated_budget)
  FROM public.categories c
  WHERE c.archived = false AND c.user_id = v_uid
    AND c.rolls_over = false
    AND NOT EXISTS (
      SELECT 1 FROM public.category_budgets cb
       WHERE cb.category_id = c.id AND cb.month = v_month);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.reconciliation_summary(p_as_of date)
 RETURNS TABLE(accounts_total numeric, savings_total numeric, unswept_current_month numeric, drift numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + INTERVAL '1 month')::date;
  v_accounts numeric := 0;
  v_savings numeric := 0;
  v_unswept numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(
    a.opening_balance
    + COALESCE((
        SELECT SUM(CASE WHEN t.type = 'expense' THEN -t.amount
                        WHEN t.type = 'income' THEN t.amount
                        WHEN t.type = 'transfer' THEN -t.amount END)
        FROM public.transactions t
        WHERE t.source_account_id = a.id AND t.user_id = v_uid AND t.occurred_on <= p_as_of
      ), 0)
    + COALESCE((
        SELECT SUM(COALESCE(t.destination_amount, t.amount))
        FROM public.transactions t
        WHERE t.destination_account_id = a.id AND t.user_id = v_uid
          AND t.type = 'transfer' AND t.occurred_on <= p_as_of
      ), 0)
  ), 0)
  INTO v_accounts
  FROM public.accounts a
  WHERE a.user_id = v_uid AND a.archived = false;

  SELECT COALESCE(SUM(cumulative_balance), 0)
    INTO v_savings
    FROM public.category_savings_balance_v2(p_as_of);

  SELECT COALESCE(SUM(cb.amount - COALESCE((
            SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                            WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
            FROM public.transactions t
            WHERE t.category_id = cb.category_id
              AND t.user_id = v_uid
              AND t.occurred_on >= v_month_start
              AND t.occurred_on < v_month_end
         ), 0)), 0)
    INTO v_unswept
    FROM public.category_budgets cb
    JOIN public.categories c ON c.id = cb.category_id
    LEFT JOIN public.category_groups g ON g.id = c.group_id
   WHERE c.user_id = v_uid
     AND c.rolls_over = false
     AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
     AND cb.month = v_month_start;

  accounts_total := v_accounts;
  savings_total := v_savings;
  unswept_current_month := v_unswept;
  drift := v_accounts - v_savings - v_unswept;
  RETURN NEXT;
END;
$function$

;

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
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'reallocation amount must be greater than zero';
  END IF;
  IF NEW.from_category_id = NEW.to_category_id THEN
    RAISE EXCEPTION 'reallocation source and target must differ';
  END IF;

  SELECT rolls_over, user_id INTO v_from_savings, v_from_user
    FROM public.categories WHERE id = NEW.from_category_id;
  SELECT rolls_over, user_id INTO v_to_savings, v_to_user
    FROM public.categories WHERE id = NEW.to_category_id;

  IF v_from_savings IS NOT TRUE OR v_to_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
  END IF;
  IF v_from_user <> NEW.user_id OR v_to_user <> NEW.user_id THEN
    RAISE EXCEPTION 'reallocation categories must belong to the same user';
  END IF;
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.validate_category_sweep_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_savings boolean;
  v_owner uuid;
BEGIN
  IF NEW.sweep_target_category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT rolls_over, user_id INTO v_savings, v_owner
    FROM public.categories WHERE id = NEW.sweep_target_category_id;
  IF v_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'sweep target must be a savings envelope';
  END IF;
  IF v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'sweep target must belong to the same user';
  END IF;
  RETURN NEW;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.validate_settings_sweep_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_savings boolean;
  v_owner uuid;
BEGIN
  IF NEW.default_sweep_category_id IS NULL THEN RETURN NEW; END IF;
  SELECT rolls_over, user_id INTO v_savings, v_owner
    FROM public.categories WHERE id = NEW.default_sweep_category_id;
  IF v_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'default sweep target must be a savings envelope';
  END IF;
  IF v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'default sweep target must belong to the same user';
  END IF;
  RETURN NEW;
END;
$function$

;

-- The column appears in this one's RETURNS TABLE, so it needs a real drop.
DROP FUNCTION IF EXISTS public.category_month_spending(date);
CREATE OR REPLACE FUNCTION public.category_month_spending(p_month date)
 RETURNS TABLE(category_id uuid, name text, group_id uuid, group_name text, kind category_group_kind, rolls_over boolean, is_scope boolean, sort_order integer, group_sort_order integer, allocated numeric, spent_or_received numeric, variance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + INTERVAL '1 month')::date;
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.group_id,
    g.name,
    -- effective kind: rolls_over wins; otherwise fall back to group kind
    -- (default 'expense' for ungrouped non-savings envelopes).
    CASE
      WHEN c.rolls_over THEN 'savings'::public.category_group_kind
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN 'income'::public.category_group_kind
      ELSE 'expense'::public.category_group_kind
    END AS kind,
    c.rolls_over,
    COALESCE(c.is_scope, false),
    c.sort_order,
    COALESCE(g.sort_order, 0),
    COALESCE(cb.amount, c.allocated_budget) AS allocated,
    COALESCE((
      SELECT
        CASE
          WHEN c.rolls_over THEN 0
          WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
            SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          ELSE
            SUM(CASE WHEN t.type = 'expense' THEN t.amount
                     WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
        END
      FROM public.transactions t
      WHERE t.category_id = c.id AND t.user_id = v_uid
        AND t.occurred_on >= v_start AND t.occurred_on < v_end
    ), 0) AS spent_or_received,
    CASE
      WHEN c.rolls_over THEN 0
      WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
        COALESCE((
          SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0) - COALESCE(cb.amount, c.allocated_budget)
      ELSE
        COALESCE(cb.amount, c.allocated_budget) - COALESCE((
          SELECT SUM(CASE WHEN t.type = 'expense' THEN t.amount
                          WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
          FROM public.transactions t
          WHERE t.category_id = c.id AND t.user_id = v_uid
            AND t.occurred_on >= v_start AND t.occurred_on < v_end
        ), 0)
    END AS variance
  FROM public.categories c
  LEFT JOIN public.category_groups g ON g.id = c.group_id
  LEFT JOIN public.category_budgets cb ON cb.category_id = c.id AND cb.month = v_start
  WHERE c.archived = false AND c.user_id = v_uid
  ORDER BY (c.group_id IS NULL), COALESCE(g.sort_order, 0), g.name NULLS LAST, c.sort_order, c.name;
END;
$function$

;

REVOKE ALL ON FUNCTION public.category_month_spending(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.category_month_spending(date) TO authenticated;
