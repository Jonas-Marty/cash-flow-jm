// Static files for the Node server (node-server.mjs): client assets from
// `vite build`, served pre-compressed when the browser accepts it.
//
// scripts/precompress.mjs writes `<file>.br` and `<file>.gz` next to every
// compressible asset at image build time; this picks the best one the request
// accepts. Unchanged when no variant exists (images, small files, local runs
// without the build step). Kept free of side effects so it can be tested.
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

export const MIME = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Extensions precompress.mjs writes variants for. */
export const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".map", ".txt"]);

/** Encodings in order of preference, with the file suffix of each variant. */
const VARIANTS = [
  { encoding: "br", suffix: ".br" },
  { encoding: "gzip", suffix: ".gz" },
];

/**
 * The encodings an Accept-Encoding header allows, best first. `q=0` excludes
 * one; `*` allows both.
 */
export function acceptedEncodings(header) {
  const allowed = new Map();
  for (const part of String(header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
    allowed.set(name, q ? Number(q[1]) : 1);
  }
  return VARIANTS.filter(({ encoding }) => {
    const q = allowed.has(encoding) ? allowed.get(encoding) : allowed.get("*");
    return q !== undefined && q > 0;
  });
}

export function safeJoin(base, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const joined = normalize(join(base, decoded));
  if (!joined.startsWith(base)) return null;
  return joined;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serve `req` from `publicDir` if it names a file there. Returns false when
 * it does not, so the caller hands the request to the app.
 */
export async function serveStatic(req, res, publicDir) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const filePath = safeJoin(publicDir, new URL(req.url, "http://x").pathname);
  if (!filePath || !(await isFile(filePath))) return false;

  const ext = extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control":
      filePath.includes("/assets/") || filePath.includes("/_build/") ? "public, max-age=31536000, immutable" : "public, max-age=300",
  };

  let body = null;
  if (COMPRESSIBLE.has(ext)) {
    headers.Vary = "Accept-Encoding";
    for (const { encoding, suffix } of acceptedEncodings(req.headers["accept-encoding"])) {
      if (await isFile(filePath + suffix)) {
        body = await readFile(filePath + suffix);
        headers["Content-Encoding"] = encoding;
        break;
      }
    }
  }
  body ??= await readFile(filePath);
  headers["Content-Length"] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
