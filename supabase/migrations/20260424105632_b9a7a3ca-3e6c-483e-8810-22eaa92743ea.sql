
-- =========================================
-- 1. Roles
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE POLICY "users read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================
-- 2. Auth providers (admin-only)
-- =========================================
CREATE TABLE public.auth_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  display_name text,
  client_id text,
  discovery_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "everyone reads enabled providers" ON public.auth_providers
  FOR SELECT
  USING (enabled = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins write providers" ON public.auth_providers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_auth_providers_updated_at
BEFORE UPDATE ON public.auth_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.auth_providers (provider, display_name, enabled) VALUES
  ('google',    'Google',           false),
  ('microsoft', 'Microsoft',        false),
  ('keycloak',  'Keycloak (OIDC)',  false);

-- =========================================
-- 3. New-user trigger
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_is_first boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO v_is_first;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN v_is_first THEN 'admin'::public.app_role ELSE 'user'::public.app_role END)
  ON CONFLICT DO NOTHING;

  IF v_is_first THEN
    UPDATE public.accounts        SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.categories      SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.category_groups SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.transactions    SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.recurring_rules SET user_id = NEW.id WHERE user_id IS NULL;
    UPDATE public.settings        SET user_id = NEW.id WHERE user_id IS NULL;
  END IF;

  INSERT INTO public.settings (user_id, currency_code, currency_symbol, day_heatmap_threshold, date_format, language)
  SELECT NEW.id, 'CHF', 'CHF', 100, 'dd.MM.yyyy', 'de'
  WHERE NOT EXISTS (SELECT 1 FROM public.settings WHERE user_id = NEW.id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- 4. DEFAULT user_id = auth.uid()
-- =========================================
ALTER TABLE public.accounts        ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.categories      ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.category_groups ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.transactions    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.recurring_rules ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.settings        ALTER COLUMN user_id SET DEFAULT auth.uid();

-- =========================================
-- 5. Replace open_all RLS
-- =========================================
DROP POLICY IF EXISTS open_all ON public.accounts;
CREATE POLICY "own accounts" ON public.accounts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS open_all ON public.categories;
CREATE POLICY "own categories" ON public.categories
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS open_all ON public.category_groups;
CREATE POLICY "own category_groups" ON public.category_groups
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS open_all ON public.transactions;
CREATE POLICY "own transactions" ON public.transactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS open_all ON public.recurring_rules;
CREATE POLICY "own recurring_rules" ON public.recurring_rules
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS open_all ON public.recurring_occurrences;
CREATE POLICY "own recurring_occurrences" ON public.recurring_occurrences
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recurring_rules r WHERE r.id = recurring_occurrences.rule_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recurring_rules r WHERE r.id = recurring_occurrences.rule_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS open_all ON public.category_budgets;
CREATE POLICY "own category_budgets" ON public.category_budgets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_budgets.category_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.categories c WHERE c.id = category_budgets.category_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS open_all ON public.transaction_tags;
CREATE POLICY "own transaction_tags" ON public.transaction_tags
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_tags.transaction_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_tags.transaction_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS open_all ON public.settings;
CREATE POLICY "own settings" ON public.settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================
-- 6. Update DB functions (per-user)
-- =========================================
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
    AND NOT EXISTS (
      SELECT 1 FROM public.category_budgets cb
       WHERE cb.category_id = c.id AND cb.month = v_month);
END;
$function$;

CREATE OR REPLACE FUNCTION public.category_month_spending(p_month date)
 RETURNS TABLE(category_id uuid, name text, group_id uuid, group_name text, kind category_group_kind, is_savings boolean, sort_order integer, group_sort_order integer, allocated numeric, spent_or_received numeric, variance numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
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
    COALESCE(g.kind, 'expense'::public.category_group_kind),
    c.is_savings,
    c.sort_order,
    COALESCE(g.sort_order, 0),
    COALESCE(cb.amount, c.allocated_budget) AS allocated,
    COALESCE((
      SELECT
        CASE WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
          SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END)
        ELSE
          SUM(CASE WHEN t.type = 'expense' THEN t.amount
                   WHEN t.type = 'income' THEN -t.amount ELSE 0 END)
        END
      FROM public.transactions t
      WHERE t.category_id = c.id AND t.user_id = v_uid
        AND t.occurred_on >= v_start AND t.occurred_on < v_end
    ), 0) AS spent_or_received,
    CASE WHEN COALESCE(g.kind, 'expense'::public.category_group_kind) = 'income' THEN
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
  ORDER BY COALESCE(g.sort_order, 0), g.name NULLS LAST, c.sort_order, c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_recurring_rules(p_today date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_horizon date;
  v_cursor date;
  v_due date;
  v_eff date;
  v_last date;
  v_tx_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT * FROM public.recurring_rules
    WHERE archived = false AND user_id = v_uid
      AND starts_on <= p_today + INTERVAL '7 days'
  LOOP
    v_horizon := CASE WHEN r.auto_post THEN p_today ELSE p_today + INTERVAL '7 days' END;
    IF r.ends_on IS NOT NULL AND r.ends_on < v_horizon THEN v_horizon := r.ends_on; END IF;

    SELECT MAX(due_on) INTO v_last FROM public.recurring_occurrences WHERE rule_id = r.id;
    IF v_last IS NULL THEN
      v_cursor := date_trunc('month', r.starts_on)::date;
    ELSE
      v_cursor := (date_trunc('month', v_last) + INTERVAL '1 month')::date;
    END IF;

    WHILE v_cursor <= v_horizon LOOP
      v_due := public.compute_due_date(v_cursor, r.day_rule, r.day_of_month);
      IF v_due >= r.starts_on AND (r.ends_on IS NULL OR v_due <= r.ends_on) AND v_due <= v_horizon THEN
        v_eff := public.compute_effective_date(v_due, r.weekend_adjust);
        IF r.auto_post AND v_eff <= p_today THEN
          INSERT INTO public.transactions
            (user_id, occurred_on, amount, type, source_account_id, destination_account_id, category_id, payee, note)
          VALUES
            (v_uid, v_eff, r.amount, r.type, r.source_account_id, r.destination_account_id, r.category_id, r.payee, r.note)
          RETURNING id INTO v_tx_id;
          INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status, transaction_id, posted_at)
          VALUES (r.id, v_due, v_eff, 'posted', v_tx_id, now())
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        ELSE
          INSERT INTO public.recurring_occurrences (rule_id, due_on, effective_on, status)
          VALUES (r.id, v_due, v_eff, 'pending')
          ON CONFLICT (rule_id, due_on) DO NOTHING;
        END IF;
      END IF;
      v_cursor := (date_trunc('month', v_cursor) + INTERVAL '1 month')::date;
    END LOOP;
  END LOOP;
END;
$function$;
