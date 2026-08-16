ALTER TABLE public.ai_audit_logs DROP CONSTRAINT IF EXISTS ai_audit_logs_kind_check;
ALTER TABLE public.ai_audit_logs ADD CONSTRAINT ai_audit_logs_kind_check CHECK (kind IN ('chat_request','tool_call','document_extract'));
ALTER TABLE public.ai_audit_logs ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE public.ai_audit_logs ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE public.ai_audit_logs ADD COLUMN IF NOT EXISTS total_tokens integer;