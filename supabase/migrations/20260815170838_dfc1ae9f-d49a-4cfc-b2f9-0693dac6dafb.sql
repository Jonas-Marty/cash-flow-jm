-- Multiple AI connections per user + per-action binding.
CREATE TABLE public.ai_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_url text NOT NULL,
  model text NOT NULL,
  api_token text,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT (id, user_id, name, base_url, model, enabled, priority, created_at, updated_at) ON public.ai_endpoints TO authenticated;
GRANT INSERT (id, user_id, name, base_url, model, enabled, priority) ON public.ai_endpoints TO authenticated;
GRANT UPDATE (name, base_url, model, enabled, priority, updated_at) ON public.ai_endpoints TO authenticated;
GRANT DELETE ON public.ai_endpoints TO authenticated;
GRANT ALL ON public.ai_endpoints TO service_role;

ALTER TABLE public.ai_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_endpoints" ON public.ai_endpoints
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX ai_endpoints_user_idx ON public.ai_endpoints(user_id, priority, created_at);

CREATE TRIGGER trg_ai_endpoints_updated
  BEFORE UPDATE ON public.ai_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_action_endpoints (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  endpoint_id uuid REFERENCES public.ai_endpoints(id) ON DELETE SET NULL,
  allow_fallback boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_action_endpoints TO authenticated;
GRANT ALL ON public.ai_action_endpoints TO service_role;

ALTER TABLE public.ai_action_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_action_endpoints" ON public.ai_action_endpoints
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_ai_action_endpoints_updated
  BEFORE UPDATE ON public.ai_action_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.ai_endpoints (user_id, name, base_url, model, api_token, enabled, priority)
SELECT c.user_id, 'Default', c.base_url, c.model, c.api_token, c.enabled, 10
FROM public.ai_credentials c
WHERE COALESCE(c.base_url, '') <> '' AND COALESCE(c.model, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM public.ai_endpoints e WHERE e.user_id = c.user_id);