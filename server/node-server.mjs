/**
 * Minimal Node HTTP server that hosts the TanStack Start SSR bundle.
 *
 * Why this file exists:
 *   The default Lovable template targets Cloudflare Workers and exports a
 *   `{ fetch(request) }` handler. Coolify on a plain VM runs Node, so we
 *   bridge Node's `http` module to that Web-standard fetch handler.
 *
 * Layout produced by `vite build --config vite.config.ts.node`:
 *   .output/
 *     server/index.mjs   <- SSR entry (exports default { fetch })
 *     public/            <- static client assets
 *
 * Env:
 *   PORT      (default 3000)
 *   HOST      (default 0.0.0.0)
 *   PUBLIC_DIR (default /app/.output/public)
 *   SERVER_ENTRY (default /app/.output/server/index.mjs)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = resolve(process.env.PUBLIC_DIR ?? "/app/.output/public");
const SERVER_ENTRY = resolve(process.env.SERVER_ENTRY ?? "/app/.output/server/index.mjs");

if (!existsSync(SERVER_ENTRY)) {
  console.error(JSON.stringify({ level: "error", event: "boot.missing_server_entry", path: SERVER_ENTRY }));
  process.exit(1);
}

const mod = await import(SERVER_ENTRY);
const handler = mod.default ?? mod;
if (!handler || typeof handler.fetch !== "function") {
  console.error(JSON.stringify({ level: "error", event: "boot.invalid_server_entry", keys: Object.keys(mod) }));
  process.exit(1);
}

const MIME = {
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

function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const joined = normalize(join(base, decoded));
  if (!joined.startsWith(base)) return null;
  return joined;
}

async function tryServeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const filePath = safeJoin(PUBLIC_DIR, new URL(req.url, "http://x").pathname);
  if (!filePath) return false;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    const cache = filePath.includes("/assets/") || filePath.includes("/_build/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "Content-Length": buf.length });
    if (req.method === "HEAD") return res.end(), true;
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

function nodeReqToWebRequest(req) {
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `${HOST}:${PORT}`;
  const url = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    else if (v != null) headers.set(k, String(v));
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeWebResponse(webRes, res) {
  const headers = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(webRes.status, headers);
  if (!webRes.body) return res.end();
  // Stream the body
  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    if (await tryServeStatic(req, res)) return;
    const webReq = nodeReqToWebRequest(req);
    const webRes = await handler.fetch(webReq);
    await writeWebResponse(webRes, res);
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "request.unhandled",
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }));
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ level: "info", event: "server.listening", host: HOST, port: PORT, publicDir: PUBLIC_DIR }));
});

function shutdown(sig) {
  console.log(JSON.stringify({ level: "info", event: "server.shutdown", signal: sig }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));