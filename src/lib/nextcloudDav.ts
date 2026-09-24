// Pure WebDAV helpers for Nextcloud: request bodies, response parsing, links.
// No I/O here, so the rules are testable; nextcloud.server.ts does the fetching.

/** What a picker is choosing, which decides the file types it offers. */
export type NcKind = "receipt" | "statement" | "any";

export interface NcEntry {
  name: string;
  /** Path inside the user's files, e.g. /Invoices/foo.pdf. Folders end without a slash. */
  path: string;
  /** Nextcloud oc:fileid. Stable across rename and move, unlike the path. */
  file_id: string | null;
  link_url: string;
  mime: string | null;
  size: number | null;
  /** ISO timestamp of the last modification, as Nextcloud reports it. */
  modified: string | null;
  is_dir: boolean;
}

// Receipts are photos or PDFs. Statements can also be the bank's CSV export,
// which is why the statement kind is wider; it matches what extraction accepts.
const KIND_MIMES: Record<Exclude<NcKind, "any">, { exact: string[]; prefix: string[] }> = {
  receipt: { exact: ["application/pdf"], prefix: ["image/"] },
  statement: {
    exact: ["application/pdf", "text/csv", "text/plain", "text/tab-separated-values"],
    prefix: ["image/"],
  },
};

export function mimeAllowed(kind: NcKind, mime: string | null): boolean {
  if (kind === "any") return true;
  if (!mime) return false;
  const m = mime.split(";")[0].trim().toLowerCase();
  const rule = KIND_MIMES[kind];
  return rule.exact.includes(m) || rule.prefix.some((p) => m.startsWith(p));
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// LIKE wildcards in the user's text would otherwise match more than they typed.
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const PROPS = `<d:prop>
        <d:displayname/>
        <d:getcontenttype/>
        <d:getcontentlength/>
        <d:getlastmodified/>
        <oc:fileid/>
        <d:resourcetype/>
      </d:prop>`;

function mimeCondition(kind: NcKind): string {
  if (kind === "any") return "";
  const rule = KIND_MIMES[kind];
  const eqs = rule.exact.map(
    (m) => `<d:eq><d:prop><d:getcontenttype/></d:prop><d:literal>${m}</d:literal></d:eq>`,
  );
  const likes = rule.prefix.map(
    (p) => `<d:like><d:prop><d:getcontenttype/></d:prop><d:literal>${p}%</d:literal></d:like>`,
  );
  return `<d:or>${[...eqs, ...likes].join("")}</d:or>`;
}

/**
 * A SEARCH body: file names containing `query`, newest first. The type filter
 * runs on the server so the result limit is spent on files the picker can use.
 */
export function buildSearchXml(user: string, query: string, kind: NcKind, limit: number): string {
  const like = `<d:like><d:prop><d:displayname/></d:prop><d:literal>%${xmlEscape(likeEscape(query))}%</d:literal></d:like>`;
  const mime = mimeCondition(kind);
  // Without a type filter, folders would match by name too; the picker lists
  // folders by browsing, so search only ever returns files.
  const notDir = `<d:not><d:is-collection/></d:not>`;
  const where = mime ? `<d:and>${like}${mime}</d:and>` : `<d:and>${like}${notDir}</d:and>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:basicsearch>
    <d:select>
      ${PROPS}
    </d:select>
    <d:from>
      <d:scope>
        <d:href>/files/${xmlEscape(user)}</d:href>
        <d:depth>infinity</d:depth>
      </d:scope>
    </d:from>
    <d:where>${where}</d:where>
    <d:orderby>
      <d:order><d:prop><d:getlastmodified/></d:prop><d:descending/></d:order>
    </d:orderby>
    <d:limit><d:nresults>${limit}</d:nresults></d:limit>
  </d:basicsearch>
</d:searchrequest>`;
}

export const PROPFIND_XML = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  ${PROPS}
</d:propfind>`;

/** Encode each segment of a path for use in a WebDAV URL. */
export function encodePath(path: string): string {
  const segs = path.split("/").filter(Boolean).map(encodeURIComponent);
  return `/${segs.join("/")}`;
}

/** WebDAV URL of a path inside the user's files. */
export function davFileUrl(base: string, user: string, path: string): string {
  return `${base}/remote.php/dav/files/${encodeURIComponent(user)}${encodePath(path)}`;
}

/**
 * The link stored on an attachment. /f/<fileid> is Nextcloud's permalink: it
 * opens the file itself and keeps working after a rename or move. Without an
 * id (a server that did not report one) the folder view is the best there is.
 */
export function fileLink(base: string, path: string, fileId: string | null): string {
  if (fileId) return `${base}/f/${encodeURIComponent(fileId)}`;
  const name = path.split("/").filter(Boolean).pop() ?? "";
  const dir = path.slice(0, path.length - name.length).replace(/\/+$/, "") || "/";
  return `${base}/apps/files/?dir=${encodeURIComponent(dir)}&scrollto=${encodeURIComponent(name)}`;
}

function tag(block: string, name: string): string | null {
  // Only the first match: a 404 propstat lists missing props as empty tags,
  // which this pattern skips because it needs a closing tag.
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? xmlUnescape(m[1]) : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse a 207 multistatus from SEARCH or PROPFIND. Entries outside the user's
 * files are dropped. Names come from the href, not displayname, because the
 * href is always present and is what later requests address.
 */
export function parseMultistatus(xml: string, base: string, user: string): NcEntry[] {
  const out: NcEntry[] = [];
  const responses = xml.match(/<d:response>[\s\S]*?<\/d:response>/g) ?? [];
  const prefix = `/remote.php/dav/files/${user}`;
  for (const r of responses) {
    const rawHref = tag(r, "d:href");
    if (!rawHref) continue;
    let href = safeDecode(rawHref);
    // Some servers answer with an absolute URL.
    const at = href.indexOf("/remote.php/dav/files/");
    if (at > 0) href = href.slice(at);
    if (!href.startsWith(prefix + "/") && href !== prefix) continue;
    const path = href.slice(prefix.length).replace(/\/+$/, "") || "/";
    const isDir = /<d:collection\s*\/>/.test(r);
    const name = path.split("/").filter(Boolean).pop() ?? "/";
    const size = tag(r, "d:getcontentlength");
    const modified = tag(r, "d:getlastmodified");
    const fileId = tag(r, "oc:fileid");
    const modDate = modified ? new Date(modified) : null;
    out.push({
      name,
      path,
      file_id: fileId || null,
      link_url: fileLink(base, path, fileId || null),
      mime: isDir ? null : tag(r, "d:getcontenttype") || null,
      size: size ? Number(size) : null,
      modified: modDate && !Number.isNaN(modDate.getTime()) ? modDate.toISOString() : null,
      is_dir: isDir,
    });
  }
  return out;
}

/**
 * A folder listing as the picker shows it: the folder itself removed, files of
 * the wrong type hidden, folders first by name, then files newest first.
 */
export function folderView(entries: NcEntry[], folder: string, kind: NcKind): NcEntry[] {
  const self = folder.replace(/\/+$/, "") || "/";
  const rest = entries.filter((e) => e.path !== self);
  const dirs = rest
    .filter((e) => e.is_dir)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const files = rest
    .filter((e) => !e.is_dir && mimeAllowed(kind, e.mime))
    .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  return [...dirs, ...files];
}

/** Normalise a user-supplied folder path: leading slash, no dot segments. */
export function cleanFolder(path: string): string {
  const segs = path.split("/").filter((s) => s && s !== "." && s !== "..");
  return `/${segs.join("/")}`;
}
