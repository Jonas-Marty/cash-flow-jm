UPDATE public.auth_providers
SET display_name = 'Generic OIDC'
WHERE provider = 'keycloak'
  AND display_name = 'Keycloak (OIDC)';