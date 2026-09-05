ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS location_source text;

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_location_source_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_location_source_check
  CHECK (location_source IS NULL OR location_source IN ('device','manual','search'));

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_location_pair_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_location_pair_check
  CHECK ((latitude IS NULL) = (longitude IS NULL));

ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS suggested_description text,
  ADD COLUMN IF NOT EXISTS suggested_category_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS suggestion_source text,
  ADD COLUMN IF NOT EXISTS suggestion_confidence numeric,
  ADD COLUMN IF NOT EXISTS suggested_at timestamptz;

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_suggestion_source_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_suggestion_source_check
  CHECK (suggestion_source IS NULL OR suggestion_source IN ('history', 'ai'));

ALTER TABLE public.pending_transactions
  DROP CONSTRAINT IF EXISTS pending_transactions_suggestion_confidence_check;
ALTER TABLE public.pending_transactions
  ADD CONSTRAINT pending_transactions_suggestion_confidence_check
  CHECK (suggestion_confidence IS NULL OR (suggestion_confidence >= 0 AND suggestion_confidence <= 1));

CREATE INDEX IF NOT EXISTS pending_transactions_unsuggested_idx
  ON public.pending_transactions (user_id, created_at DESC)
  WHERE status = 'pending' AND category_id IS NULL AND suggested_at IS NULL;

ALTER TABLE public.ai_audit_logs DROP CONSTRAINT IF EXISTS ai_audit_logs_kind_check;
ALTER TABLE public.ai_audit_logs ADD CONSTRAINT ai_audit_logs_kind_check
  CHECK (kind IN ('chat_request', 'tool_call', 'document_extract', 'statement_classify', 'pending_enrich', 'transcribe'));