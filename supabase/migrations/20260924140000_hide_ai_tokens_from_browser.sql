-- Hide AI API tokens from the browser, which the column grants never did.
--
-- 20260815170838 granted authenticated a column list on ai_endpoints that left
-- out api_token, meaning "the browser may read everything but the token". It
-- had no effect: Supabase's default privileges had already granted the whole
-- table to anon and authenticated, and a table-level grant covers every
-- column. has_column_privilege('authenticated', 'public.ai_endpoints',
-- 'api_token', 'SELECT') was true in production on 2026-09-24, so any script
-- running in the signed-in page could read the user's own provider token.
--
-- Nothing in the browser reads or writes ai_endpoints: listing, saving and
-- deleting connections all go through server functions using the service
-- role, filtered by the caller's user id. So the table is revoked outright
-- rather than repaired column by column. Revoking a table privilege also
-- revokes the column privileges granted on it.
--
-- ai_credentials is the predecessor table, empty and unused since the move to
-- ai_endpoints, and had the same exposure.
--
-- Any new table holding a secret needs the same REVOKE: the default
-- privileges grant it to the browser roles at creation.

REVOKE ALL ON public.ai_endpoints FROM anon, authenticated;
REVOKE ALL ON public.ai_credentials FROM anon, authenticated;
