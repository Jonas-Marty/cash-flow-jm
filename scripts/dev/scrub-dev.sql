-- Make a freshly cloned dev database safe to run against.
--
-- The clone carries production rows verbatim, including credentials for real
-- external systems. Everything here is about not letting a throwaway instance
-- act on the outside world; the financial data itself is left alone, that is
-- the point of cloning.
--
-- Deliberately kept: ai_credentials / ai_endpoints (so AI suggestions can be
-- tested), api_tokens (so the public API can be exercised), auth.users (bcrypt
-- password hashes do not depend on the JWT secret, so production credentials
-- log in on dev).

BEGIN;

-- Nextcloud: keep the connection rows so the UI still renders, drop what would
-- let dev talk to the real server. client_secret is NOT NULL, hence the blank.
UPDATE public.nextcloud_connections
   SET client_secret = '',
       access_token = NULL,
       refresh_token = NULL,
       token_expires_at = NULL;

-- Webhooks: keep the definitions, never fire them from dev.
UPDATE public.webhooks SET active = false;

-- Sessions were signed with the production JWT secret and are meaningless under
-- the dev one; clearing them avoids confusing refresh failures on first load.
TRUNCATE auth.refresh_tokens, auth.sessions, auth.mfa_amr_claims, auth.flow_state CASCADE;

COMMIT;
