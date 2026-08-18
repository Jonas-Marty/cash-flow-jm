// Server-only Nextcloud helpers. Never import from client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

export function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getConnection(userId: string): Promise<NextcloudConnRow | null> {
  const { data, error } = await supabaseAdmin
    .from("nextcloud_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NextcloudConnRow | null) ?? null;
}

export async function exchangeCodeForToken(conn: { base_url: string; client_id: string; client_secret: string }, code: string, redirectUri: string) {
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
  return (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
    user_id?: string;
  };
}

export async function refreshToken(conn: NextcloudConnRow): Promise<NextcloudConnRow> {
  if (!conn.refresh_token) throw new Error("No refresh token stored; please reconnect Nextcloud");
  const tokenUrl = `${trimBaseUrl(conn.base_url)}/apps/oauth2/api/v1/token`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: conn.refresh_token,
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
    throw new Error(`Nextcloud token refresh failed [${res.status}]: ${text}`);
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; user_id?: string };
  const expires_at = new Date(Date.now() + (j.expires_in - 30) * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("nextcloud_connections")
    .update({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      token_expires_at: expires_at,
      nextcloud_user: j.user_id ?? conn.nextcloud_user,
    })
    .eq("user_id", conn.user_id);
  if (error) throw new Error(error.message);
  return { ...conn, access_token: j.access_token, refresh_token: j.refresh_token, token_expires_at: expires_at };
}

export async function getValidConnection(userId: string): Promise<NextcloudConnRow> {
  const conn = await getConnection(userId);
  if (!conn) throw new Error("Nextcloud not connected");
  if (!conn.access_token) throw new Error("Nextcloud OAuth not completed");
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) {
    return await refreshToken(conn);
  }
  return conn;
}

export interface NextcloudFileResult {
  name: string;
  path: string; // path inside the user's files (e.g. /Invoices/foo.pdf)
  link_url: string;
  mime: string | null;
  size: number | null;
  is_dir: boolean;
}

/** WebDAV REPORT (search-files-by-name) using basic SEARCH on the user's files. */
export async function searchFiles(conn: NextcloudConnRow, query: string, limit = 25): Promise<NextcloudFileResult[]> {
  const user = conn.nextcloud_user;
  if (!user) throw new Error("Nextcloud user unknown; please reconnect");
  const base = trimBaseUrl(conn.base_url);
  const davEndpoint = `${base}/remote.php/dav`;
  // Use the SEARCH method on /remote.php/dav with a basic file-name LIKE.
  // See https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/search.html
  const safeQ = query.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:basicsearch>
    <d:select>
      <d:prop>
        <d:displayname/>
        <d:getcontenttype/>
        <d:getcontentlength/>
        <d:resourcetype/>
      </d:prop>
    </d:select>
    <d:from>
      <d:scope>
        <d:href>/files/${user}</d:href>
        <d:depth>infinity</d:depth>
      </d:scope>
    </d:from>
    <d:where>
      <d:like>
        <d:prop><d:displayname/></d:prop>
        <d:literal>%${safeQ}%</d:literal>
      </d:like>
    </d:where>
    <d:orderby/>
    <d:limit><d:nresults>${limit}</d:nresults></d:limit>
  </d:basicsearch>
</d:searchrequest>`;

  const res = await fetch(davEndpoint, {
    method: "SEARCH",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/xml; charset=utf-8",
      Accept: "application/xml",
    },
    body: xml,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nextcloud search failed [${res.status}]: ${text.slice(0, 500)}`);
  }
  const text = await res.text();
  return parseSearchXml(text, base, user);
}

/** Download a file from the user's Nextcloud files via WebDAV. */
export async function downloadFile(
  conn: NextcloudConnRow,
  path: string,
  maxBytes = 15 * 1024 * 1024,
): Promise<{ name: string; mime: string | null; base64: string }> {
  const user = conn.nextcloud_user;
  if (!user) throw new Error("Nextcloud user unknown; please reconnect");
  const base = trimBaseUrl(conn.base_url);
  const encoded = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const url = `${base}/remote.php/dav/files/${encodeURIComponent(user)}${encoded.startsWith("/") ? encoded : `/${encoded}`}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.access_token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nextcloud download failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new Error("File is too large (max 15 MB)");
  const name = path.split("/").filter(Boolean).pop() ?? "file";
  return {
    name,
    mime: res.headers.get("content-type"),
    base64: Buffer.from(buf).toString("base64"),
  };
}

function parseSearchXml(xml: string, base: string, user: string): NextcloudFileResult[] {
  const out: NextcloudFileResult[] = [];
  const responseRe = /<d:response[\s\S]*?<\/d:response>/g;
  const responses = xml.match(responseRe) ?? [];
  const userPrefix = `/remote.php/dav/files/${user}`;
  for (const r of responses) {
    const hrefMatch = r.match(/<d:href>([^<]*)<\/d:href>/);
    if (!hrefMatch) continue;
    let href = decodeURIComponent(hrefMatch[1]);
    // href is like /remote.php/dav/files/USER/Folder/file.pdf
    if (!href.startsWith(userPrefix)) continue;
    const path = href.slice(userPrefix.length) || "/";
    const mimeM = r.match(/<d:getcontenttype>([^<]*)<\/d:getcontenttype>/);
    const sizeM = r.match(/<d:getcontentlength>([^<]*)<\/d:getcontentlength>/);
    const isDir = /<d:collection\s*\/?>/i.test(r);
    if (isDir) continue;
    const name = path.split("/").filter(Boolean).pop() ?? path;
    // Browser-friendly link: open the file in Nextcloud web UI.
    // Files app uses the "openfile" intent on the home, parent dir as dir param.
    const dir = path.substring(0, path.length - name.length).replace(/\/+$/, "") || "/";
    const link_url = `${base}/apps/files/?dir=${encodeURIComponent(dir)}&openfile=true&scrollto=${encodeURIComponent(name)}`;
    out.push({
      name,
      path,
      link_url,
      mime: mimeM ? mimeM[1] : null,
      size: sizeM ? Number(sizeM[1]) : null,
      is_dir: false,
    });
  }
  return out;
}