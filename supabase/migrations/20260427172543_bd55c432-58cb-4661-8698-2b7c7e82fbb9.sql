
CREATE TABLE IF NOT EXISTS public.transaction_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  source text NOT NULL DEFAULT 'nextcloud',
  display_name text NOT NULL,
  link_url text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction_id ON public.transaction_attachments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_attachments_user_id ON public.transaction_attachments(user_id);
ALTER TABLE public.transaction_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own attachments" ON public.transaction_attachments;
CREATE POLICY "own attachments" ON public.transaction_attachments
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_attachments_updated ON public.transaction_attachments;
CREATE TRIGGER trg_attachments_updated
  BEFORE UPDATE ON public.transaction_attachments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.nextcloud_connections (
  user_id uuid NOT NULL PRIMARY KEY DEFAULT auth.uid(),
  base_url text NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  nextcloud_user text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nextcloud_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own nextcloud connection" ON public.nextcloud_connections;
CREATE POLICY "own nextcloud connection" ON public.nextcloud_connections
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
DROP TRIGGER IF EXISTS trg_nextcloud_connections_updated ON public.nextcloud_connections;
CREATE TRIGGER trg_nextcloud_connections_updated
  BEFORE UPDATE ON public.nextcloud_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.api_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON public.api_tokens(user_id);
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own api tokens" ON public.api_tokens;
CREATE POLICY "own api tokens" ON public.api_tokens
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
