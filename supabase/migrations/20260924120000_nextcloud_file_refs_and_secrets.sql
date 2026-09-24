-- Nextcloud: stable file references, a single-use OAuth state, and secrets the
-- browser can no longer read.

-- 1. Attachments remember which Nextcloud file they point at.
--
-- The link used to be built from the file's path. On current Nextcloud that
-- opens the folder rather than the file, and it breaks as soon as the file is
-- renamed or moved. The link is now the /f/<fileid> permalink, and the id and
-- path are kept so a later feature (preview, reading a receipt) can reach the
-- file without asking the user again. Both stay NULL for links added by hand
-- or through the public API.
ALTER TABLE public.transaction_attachments
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_path text;

COMMENT ON COLUMN public.transaction_attachments.external_id IS
  'Provider file id (Nextcloud oc:fileid). Survives rename and move; link_url is built from it.';
COMMENT ON COLUMN public.transaction_attachments.external_path IS
  'Path inside the provider account when the link was made. Informational: it goes stale on rename, external_id does not.';

-- 2. The OAuth state is a random nonce stored on the row.
--
-- It replaces an HMAC signed with a server secret (NEXTCLOUD_STATE_SECRET, or
-- the service-role key as fallback). A stored nonce needs no secret at all, is
-- single-use because the callback clears it, and cannot be replayed by another
-- deployment that happens to share the key.
ALTER TABLE public.nextcloud_connections
  ADD COLUMN IF NOT EXISTS oauth_state text,
  ADD COLUMN IF NOT EXISTS oauth_state_created_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS nextcloud_connections_oauth_state_key
  ON public.nextcloud_connections (oauth_state)
  WHERE oauth_state IS NOT NULL;

-- 3. Only the server reads or writes this table.
--
-- Supabase's default privileges grant every table to anon and authenticated,
-- so RLS alone let the signed-in browser read its own client_secret,
-- access_token and refresh_token. Every access now goes through server
-- functions using the service role, scoped by the caller's user id.
REVOKE ALL ON public.nextcloud_connections FROM anon, authenticated;
