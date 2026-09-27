-- Additional models on a connection.
--
-- An action binding can already name another model on its connection
-- (20260906130000), but the settings picker only offered what the provider's
-- GET /models returned — nothing when a provider does not list models, and an
-- unsorted wall when a proxy lists hundreds. A connection now carries the
-- extra models the user wants to choose from. Only the default `model` is
-- probed for availability.
ALTER TABLE public.ai_endpoints
  ADD COLUMN IF NOT EXISTS extra_models text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.ai_endpoints.extra_models IS
  'Further models on this connection offered in the per-action model picker. The default model is not repeated here.';
