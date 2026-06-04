
-- ai_credentials: BYO OpenAI-compatible endpoint per user.
-- The api_token column is intentionally hidden from the authenticated role
-- via column-level grants. The server reads it via the service role.
CREATE TABLE public.ai_credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  base_url text,
  model text,
  api_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Column-level grants: authenticated cannot read or write api_token.
GRANT SELECT (user_id, enabled, base_url, model, created_at, updated_at) ON public.ai_credentials TO authenticated;
GRANT INSERT (user_id, enabled, base_url, model) ON public.ai_credentials TO authenticated;
GRANT UPDATE (enabled, base_url, model, updated_at) ON public.ai_credentials TO authenticated;
GRANT DELETE ON public.ai_credentials TO authenticated;
GRANT ALL ON public.ai_credentials TO service_role;

ALTER TABLE public.ai_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ai_credentials"
  ON public.ai_credentials
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_ai_credentials_updated
  BEFORE UPDATE ON public.ai_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ai_conversations
CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_conversations TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_conversations" ON public.ai_conversations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX ai_conversations_user_idx ON public.ai_conversations(user_id, updated_at DESC);

CREATE TRIGGER trg_ai_conversations_updated
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ai_messages
CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai_messages" ON public.ai_messages
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX ai_messages_conv_idx ON public.ai_messages(conversation_id, created_at);
