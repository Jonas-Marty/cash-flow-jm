-- Per-action model on an existing connection.
--
-- One provider (a LiteLLM proxy, an Ollama host) usually serves several models,
-- and the actions want different ones: a small fast model for chat, a larger
-- one for the classification passes, a vision model for statement photos.
-- Modelling that as three connections meant three availability probes against
-- the same host, so a connection now carries a default model and each action
-- may name another model on it.
--
-- NULL = use the connection's own `model`, which is what every existing row
-- means today.
ALTER TABLE public.ai_action_endpoints
  ADD COLUMN IF NOT EXISTS model text;

COMMENT ON COLUMN public.ai_action_endpoints.model IS
  'Model to use on the bound connection for this action. NULL = the connection default.';
