-- Suggestions on pending transactions.
--
-- A pending row that arrives without a category gets one proposed, first from
-- the user's own history (same merchant seen before), then from the configured
-- AI connection. The proposal lives in these columns and nowhere else: the
-- user's tap on /pending is what moves it into category_id / description.
-- Mirrors what statement_import_lines already has.
ALTER TABLE public.pending_transactions
  ADD COLUMN IF NOT EXISTS suggested_description text,
  ADD COLUMN IF NOT EXISTS suggested_category_id uuid
    REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suggested_tags text[] NOT NULL DEFAULT '{}',
  -- 'history' = an earlier transaction matched; 'ai' = the model guessed.
  -- NULL with suggested_at set = looked, found nothing worth proposing.
  ADD COLUMN IF NOT EXISTS suggestion_source text,
  -- 0..1. Stored so a later auto-apply rule has something to gate on.
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

-- The catch-up pass looks for "pending, uncategorised, not yet looked at".
CREATE INDEX IF NOT EXISTS pending_transactions_unsuggested_idx
  ON public.pending_transactions (user_id, created_at DESC)
  WHERE status = 'pending' AND category_id IS NULL AND suggested_at IS NULL;

-- The activity log gets honest kinds for the two classification passes, which
-- until now were filed under document_extract.
ALTER TABLE public.ai_audit_logs DROP CONSTRAINT IF EXISTS ai_audit_logs_kind_check;
ALTER TABLE public.ai_audit_logs ADD CONSTRAINT ai_audit_logs_kind_check
  CHECK (kind IN ('chat_request', 'tool_call', 'document_extract', 'statement_classify', 'pending_enrich', 'transcribe'));
