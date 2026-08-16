ALTER TABLE public.ai_endpoints ADD COLUMN IF NOT EXISTS transcribe_model text;

GRANT SELECT (transcribe_model) ON public.ai_endpoints TO authenticated;
GRANT INSERT (transcribe_model) ON public.ai_endpoints TO authenticated;
GRANT UPDATE (transcribe_model) ON public.ai_endpoints TO authenticated;

ALTER TABLE public.ai_audit_logs DROP CONSTRAINT IF EXISTS ai_audit_logs_kind_check;
ALTER TABLE public.ai_audit_logs ADD CONSTRAINT ai_audit_logs_kind_check CHECK (kind IN ('chat_request','tool_call','document_extract','transcribe'));