-- The generic OIDC sign-in row was called 'keycloak' because the auth service
-- (GoTrue) used to offer generic OIDC only through its Keycloak provider,
-- which hardcodes Keycloak's URL layout and so never worked with Authentik or
-- Zitadel. Since GoTrue 2.187 a generic OIDC provider is registered through its
-- admin API as 'custom:oidc'; the app writes it from Settings -> Integrations.
UPDATE public.auth_providers
SET provider = 'oidc'
WHERE provider = 'keycloak';

COMMENT ON TABLE public.auth_providers IS
  'Sign-in buttons shown on the login page, and their non-secret settings. '
  'For provider = ''oidc'' the auth service holds the working configuration '
  '(including the client secret) as custom provider ''custom:oidc''; '
  'client_id and discovery_url here mirror it for display.';
