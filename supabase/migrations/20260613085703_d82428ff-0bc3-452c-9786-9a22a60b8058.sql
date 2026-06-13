ALTER TABLE public.settings
  ADD COLUMN active_scope_id uuid NULL REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.validate_active_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.active_scope_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = NEW.active_scope_id
      AND c.user_id = NEW.user_id
      AND c.is_scope = true
      AND c.closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active scope must be an open scope owned by the same user';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_settings_active_scope
BEFORE INSERT OR UPDATE OF active_scope_id, user_id ON public.settings
FOR EACH ROW EXECUTE FUNCTION public.validate_active_scope();

CREATE OR REPLACE FUNCTION public.clear_closed_active_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
    UPDATE public.settings
    SET active_scope_id = NULL
    WHERE user_id = NEW.user_id
      AND active_scope_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_active_scope_when_closed
AFTER UPDATE OF closed_at ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.clear_closed_active_scope();