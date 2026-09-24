// Server-only Nextcloud helpers. Never import from client code.
//
// The browser has no grant on nextcloud_connections (see the 20260924120000
// migration), so every read and write here goes through the service role and
// is scoped by the caller's user id explicitly.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  NextcloudReconnectError,
  afterRefusedRefresh,
  isExpired,
  refreshRefused,
  singleFlight,
} from "@/lib/nextcloudAuth";
import {
  PROPFIND_XML,
  buildSearchXml,
  cleanFolder,
  davFileUrl,
  folderView,
  parseMultistatus,
  type NcEntry,
  type NcKind,
} from "@/lib/nextcloudDav";

export interface NextcloudConnRow {
  user_id: string;
  base_url: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  nextcloud_user: string | null;
}

const CONN_COLS =
  "user_id, base_url, client_id, client_secret, access_token, refresh_token, token_expires_at, scope, nextcloud_user";

export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Where Nextcloud sends the browser back to. Both the authorize request and
 * the token exchange must name the same URL, so both build it here from the
 * request's host. Behind the proxy the app itself is reached over plain http,
 * so the scheme cannot come from the request; deployed hosts are https.
 */
export function callbackUrlForHost(host: string): string {
  const local = host.startsWith("localhost") || host.startsWith("127.");
  return `${local ? "http" : "https"}://${host}/api/nextcloud/callback`;
}

export async function getConnection(userId: string): Promise<NextcloudConnRow | null> {
  const { data, error } = await supabaseAdmin
    .from("nextcloud_connections")
    .select(CONN_COLS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NextcloudConnRow | null) ?? null;
}

/** Seconds Nextcloud grants, minus a margin so a request never starts on a token about to lapse. */
function expiryFrom(expiresIn: number): string {
  return new Date(Date.now() + (expiresIn - 30) * 1000).toISOString();
}

export async function exchangeCodeForToken(
  conn: { base_url: string; client_id: string; client_secret: string },
  code: string,
  redirectUri: string,
) {
  const tokenUrl = `${trimBaseUrl(conn.base_url)}/apps/oauth2/api/v1/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: conn.client_id,
    client_secret: conn.client_secret,
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nextcloud token exchange failed [${res.status}]: ${text}`);
  }
  const j = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
    user_id?: string;
  };
  return { ...j, expires_at: expiryFrom(j.expires_in) };
}

/**
 * Forget the tokens but keep the configuration and the Nextcloud user name,
 * so Settings can say the connection was lost rather than never made.
 */
async function clearTokens(userId: string): Promise<void> {
  await supabaseAdmin
    .from("nextcloud_connections")
    .update({ access_token: null, refresh_token: null, token_expires_at: null })
    .eq("user_id", userId);
}

class RefreshRefusedError extends Error {}

/**
 * Redeem the refresh token once and store the new pair. Nextcloud has already
 * voided the old token when it answers, so a lost write here would strand the
 * connection; the write is retried once before giving up.
 */
async function redeemRefreshToken(conn: NextcloudConnRow): Promise<NextcloudConnRow> {
  const tokenUrl = `${trimBaseUrl(conn.base_url)}/apps/oauth2/api/v1/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token ?? "",
    client_id: conn.client_id,
    client_secret: conn.client_secret,
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    if (refreshRefused(res.status)) throw new RefreshRefusedError(text.slice(0, 200));
    throw new Error(`Nextcloud token refresh failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; user_id?: string };
  const next = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    token_expires_at: expiryFrom(j.expires_in),
    nextcloud_user: j.user_id ?? conn.nextcloud_user,
  };
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabaseAdmin.from("nextcloud_connections").update(next).eq("user_id", conn.user_id);
    if (!error) return { ...conn, ...next };
    lastError = error.message;
  }
  throw new Error(`Renewed the Nextcloud token but could not store it: ${lastError}`);
}

const renewOnce = singleFlight<NextcloudConnRow>();

/** Renew the access token, at most once at a time per user. */
function renew(conn: NextcloudConnRow): Promise<NextcloudConnRow> {
  return renewOnce(conn.user_id, async () => {
    const sent = conn.refresh_token;
    if (!sent) throw new NextcloudReconnectError("no refresh token stored");
    // Another request, or another instance of the app, may have renewed since
    // `conn` was read. Its fresh pair is good; redeeming ours would be refused.
    const fresh = await getConnection(conn.user_id);
    if (fresh?.access_token && fresh.refresh_token && fresh.refresh_token !== sent && !isExpired(fresh.token_expires_at)) {
      return fresh;
    }
    try {
      return await redeemRefreshToken(conn);
    } catch (e) {
      if (!(e instanceof RefreshRefusedError)) throw e;
      const stored = await getConnection(conn.user_id);
      if (afterRefusedRefresh(sent, stored) === "use-stored") return stored!;
      await clearTokens(conn.user_id);
      throw new NextcloudReconnectError("refresh token refused");
    }
  });
}

export async function getValidConnection(userId: string): Promise<NextcloudConnRow> {
  const conn = await getConnection(userId);
  if (!conn) throw new NextcloudReconnectError("not configured");
  if (!conn.access_token || !conn.nextcloud_user) throw new NextcloudReconnectError("not connected");
  if (isExpired(conn.token_expires_at)) return await renew(conn);
  return conn;
}

/**
 * One authenticated WebDAV request. A 401 on a token that should still be
 * valid (revoked in Nextcloud, or renewed elsewhere) gets one renewal and one
 * retry; a second 401 means the connection is gone.
 */
async function davFetch(
  userId: string,
  build: (conn: NextcloudConnRow & { nextcloud_user: string }) => [string, RequestInit],
): Promise<{ conn: NextcloudConnRow & { nextcloud_user: string }; res: Response }> {
  const send = (c: NextcloudConnRow) => {
    const conn = c as NextcloudConnRow & { nextcloud_user: string };
    const [url, init] = build(conn);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${conn.access_token}`);
    return fetch(url, { ...init, headers }).then((res) => ({ conn, res }));
  };
  let out = await send(await getValidConnection(userId));
  if (out.res.status === 401) {
    out = await send(await renew(out.conn));
    if (out.res.status === 401) {
      await clearTokens(userId);
      throw new NextcloudReconnectError("Nextcloud rejected the renewed token");
    }
  }
  return out;
}

/** Files whose name contains `query`, newest first, limited to what `kind` can use. */
export async function searchFiles(userId: string, query: string, kind: NcKind, limit = 25): Promise<NcEntry[]> {
  const { conn, res } = await davFetch(userId, (c) => [
    `${trimBaseUrl(c.base_url)}/remote.php/dav`,
    {
      method: "SEARCH",
      headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
      body: buildSearchXml(c.nextcloud_user, query, kind, limit),
    },
  ]);
  const text = await res.text();
  if (res.status !== 207) throw new Error(`Nextcloud search failed [${res.status}]: ${text.slice(0, 300)}`);
  return parseMultistatus(text, trimBaseUrl(conn.base_url), conn.nextcloud_user).filter((e) => !e.is_dir);
}

/** One folder's contents: subfolders first, then usable files newest first. */
export async function listFolder(userId: string, folder: string, kind: NcKind): Promise<{ path: string; entries: NcEntry[] }> {
  const path = cleanFolder(folder);
  const { conn, res } = await davFetch(userId, (c) => [
    `${davFileUrl(trimBaseUrl(c.base_url), c.nextcloud_user, path)}/`,
    {
      method: "PROPFIND",
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
      body: PROPFIND_XML,
    },
  ]);
  const text = await res.text();
  if (res.status === 404) throw new Error(`Folder not found: ${path}`);
  if (res.status !== 207) throw new Error(`Nextcloud listing failed [${res.status}]: ${text.slice(0, 300)}`);
  const entries = parseMultistatus(text, trimBaseUrl(conn.base_url), conn.nextcloud_user);
  return { path, entries: folderView(entries, path, kind) };
}

/** Download one file from the user's Nextcloud, refusing anything over the limit. */
export async function downloadFile(
  userId: string,
  path: string,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<{ name: string; mime: string | null; bytes: Uint8Array; baseUrl: string }> {
  const { conn, res } = await davFetch(userId, (c) => [
    davFileUrl(trimBaseUrl(c.base_url), c.nextcloud_user, path),
    { method: "GET" },
  ]);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nextcloud download failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const tooBig = () => new Error(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw tooBig();
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw tooBig();
  return {
    name: path.split("/").filter(Boolean).pop() ?? "file",
    mime: res.headers.get("content-type")?.split(";")[0].trim() || null,
    bytes,
    baseUrl: trimBaseUrl(conn.base_url),
  };
}
