-- 1. Reallocations table
CREATE TABLE public.category_reallocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  from_category_id uuid NOT NULL,
  to_category_id uuid NOT NULL,
  amount numeric NOT NULL,
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.category_reallocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own category_reallocations"
  ON public.category_reallocations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_realloc_from ON public.category_reallocations(from_category_id);
CREATE INDEX idx_realloc_to ON public.category_reallocations(to_category_id);
CREATE INDEX idx_realloc_user_date ON public.category_reallocations(user_id, occurred_on);

CREATE TRIGGER update_realloc_updated_at
  BEFORE UPDATE ON public.category_reallocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validation: both sides must be savings envelopes owned by same user, amount > 0, not same envelope
CREATE OR REPLACE FUNCTION public.validate_category_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
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

  SELECT is_savings, user_id INTO v_from_savings, v_from_user
    FROM public.categories WHERE id = NEW.from_category_id;
  SELECT is_savings, user_id INTO v_to_savings, v_to_user
    FROM public.categories WHERE id = NEW.to_category_id;

  IF v_from_savings IS NOT TRUE OR v_to_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'both reallocation endpoints must be savings envelopes';
  END IF;
  IF v_from_user <> NEW.user_id OR v_to_user <> NEW.user_id THEN
    RAISE EXCEPTION 'reallocation categories must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_category_reallocation
  BEFORE INSERT OR UPDATE ON public.category_reallocations
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_reallocation();

-- 2. Sweep target columns
ALTER TABLE public.categories
  ADD COLUMN sweep_target_category_id uuid;
ALTER TABLE public.category_groups
  ADD COLUMN sweep_target_category_id uuid;
ALTER TABLE public.settings
  ADD COLUMN default_sweep_category_id uuid;

-- Validation: sweep target must be a savings envelope owned by the user
CREATE OR REPLACE FUNCTION public.validate_category_sweep_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_savings boolean;
  v_owner uuid;
BEGIN
  IF NEW.sweep_target_category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT is_savings, user_id INTO v_savings, v_owner
    FROM public.categories WHERE id = NEW.sweep_target_category_id;
  IF v_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'sweep target must be a savings envelope';
  END IF;
  IF v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'sweep target must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_category_sweep_target
  BEFORE INSERT OR UPDATE OF sweep_target_category_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_sweep_target();

CREATE TRIGGER trg_validate_group_sweep_target
  BEFORE INSERT OR UPDATE OF sweep_target_category_id ON public.category_groups
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_sweep_target();

CREATE OR REPLACE FUNCTION public.validate_settings_sweep_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_savings boolean;
  v_owner uuid;
BEGIN
  IF NEW.default_sweep_category_id IS NULL THEN RETURN NEW; END IF;
  SELECT is_savings, user_id INTO v_savings, v_owner
    FROM public.categories WHERE id = NEW.default_sweep_category_id;
  IF v_savings IS NOT TRUE THEN
    RAISE EXCEPTION 'default sweep target must be a savings envelope';
  END IF;
  IF v_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'default sweep target must belong to the same user';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settings_sweep_target
  BEFORE INSERT OR UPDATE OF default_sweep_category_id ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_settings_sweep_target();

-- Block deleting a savings envelope still used as a sweep target
CREATE OR REPLACE FUNCTION public.block_sweep_target_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
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
$$;

CREATE TRIGGER trg_block_sweep_target_delete
  BEFORE DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.block_sweep_target_delete();

-- 3. Per-savings-envelope balance computation
-- Returns cumulative balance + this-month activity + breakdown.
CREATE OR REPLACE FUNCTION public.category_savings_balance(p_as_of date)
RETURNS TABLE(
  category_id uuid,
  name text,
  archived boolean,
  cumulative_balance numeric,
  month_activity numeric,
  from_transactions numeric,
  from_reallocations numeric,
  from_sweeps numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     WHERE c.user_id = v_uid AND c.is_savings = true
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
       AND c.is_savings = false
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
$$;

-- 4. Reconciliation: compare account totals vs reserved savings
CREATE OR REPLACE FUNCTION public.reconciliation_summary(p_as_of date)
RETURNS TABLE(
  accounts_total numeric,
  savings_total numeric,
  unswept_current_month numeric,
  drift numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_month_start date := date_trunc('month', p_as_of)::date;
  v_month_end date := (date_trunc('month', p_as_of) + INTERVAL '1 month')::date;
  v_accounts numeric := 0;
  v_savings numeric := 0;
  v_unswept numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  -- Account totals as of p_as_of (exclude pending recurring; reconciliation should use realised cash).
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

  -- Sum of cumulative savings balances
  SELECT COALESCE(SUM(cumulative_balance), 0)
    INTO v_savings
    FROM public.category_savings_balance(p_as_of);

  -- This month's not-yet-swept variance for non-savings envelopes (informational)
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
     AND c.is_savings = false
     AND COALESCE(g.kind, 'expense'::category_group_kind) <> 'income'
     AND cb.month = v_month_start;

  accounts_total := v_accounts;
  savings_total := v_savings;
  unswept_current_month := v_unswept;
  drift := v_accounts - v_savings - v_unswept;
  RETURN NEXT;
END;
$$;

-- 5. Atomic helper: archive savings envelope, move balance to target via reallocation
CREATE OR REPLACE FUNCTION public.archive_savings_envelope(p_id uuid, p_move_remaining_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_balance numeric;
  v_is_savings boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT is_savings INTO v_is_savings FROM public.categories WHERE id = p_id AND user_id = v_uid;
  IF v_is_savings IS NOT TRUE THEN
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
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_id, p_move_remaining_to, v_balance, CURRENT_DATE, 'Auto-move on archive');
    ELSE
      INSERT INTO public.category_reallocations (user_id, from_category_id, to_category_id, amount, occurred_on, note)
      VALUES (v_uid, p_move_remaining_to, p_id, -v_balance, CURRENT_DATE, 'Auto-move on archive (cover deficit)');
    END IF;
  END IF;

  UPDATE public.categories SET archived = true WHERE id = p_id AND user_id = v_uid;
END;
$$;