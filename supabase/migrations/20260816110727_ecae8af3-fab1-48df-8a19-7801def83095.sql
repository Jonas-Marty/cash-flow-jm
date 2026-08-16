ALTER TABLE public.ai_endpoints
  ADD COLUMN IF NOT EXISTS context_level text NOT NULL DEFAULT 'compact';

ALTER TABLE public.ai_endpoints
  DROP CONSTRAINT IF EXISTS ai_endpoints_context_level_check;

ALTER TABLE public.ai_endpoints
  ADD CONSTRAINT ai_endpoints_context_level_check
  CHECK (context_level IN ('off','compact','full'));