-- Chat attachments as conversation context, and per-model capability flags.
--
-- 1. ai_attachments: a file the user attached in the assistant chat. The bytes
--    live in the private ai-attachments bucket under <user_id>/…; the row keeps
--    the extracted text so later turns (and the read_attachment tool) do not
--    re-parse the PDF. conversation_id is null for the non-persisted sidebar
--    chat; those rows, and rows whose conversation was deleted, are removed by
--    /api/public/prune-audit after a few days.
--
-- 2. ai_endpoints.capabilities: what each model on a connection was found to
--    support, keyed by model id because an action binding can pick another
--    model on the same connection:
--      {"gpt-4o-mini": {"tools": true, "vision": true, "checked_at": "…"}}
--    A missing key or null value means "not checked". ai_endpoints stays
--    revoked from the browser roles (20260924140000); only server functions
--    read or write it.

CREATE TABLE IF NOT EXISTS public.ai_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  extracted_text text,
  page_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_attachments_user_created_idx ON public.ai_attachments (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_attachments_conversation_idx ON public.ai_attachments (conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_attachments TO authenticated;
REVOKE ALL ON public.ai_attachments FROM anon;
GRANT ALL ON public.ai_attachments TO service_role;
ALTER TABLE public.ai_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own ai_attachments" ON public.ai_attachments;
CREATE POLICY "own ai_attachments" ON public.ai_attachments
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Private bucket, 15 MB per file (the chat accepts up to three per message).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ai-attachments', 'ai-attachments', false, 15728640)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "ai attachments owner select" ON storage.objects;
CREATE POLICY "ai attachments owner select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ai-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "ai attachments owner insert" ON storage.objects;
CREATE POLICY "ai attachments owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ai-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "ai attachments owner delete" ON storage.objects;
CREATE POLICY "ai attachments owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ai-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

ALTER TABLE public.ai_endpoints
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;
