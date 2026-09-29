/**
 * Minimal Node HTTP server that hosts the TanStack Start SSR bundle.
 *
 * Why this file exists:
 *   The default vite config targets Cloudflare Workers and exports a
 *   `{ fetch(request) }` handler. Coolify on a plain VM runs Node, so we
 *   bridge Node's `http` module to that Web-standard fetch handler.
 *
 * Layout produced by `vite build --config vite.config.node.ts`:
 *   dist/
 *     server/server.js   <- SSR entry (exports default { fetch })
 *     client/            <- static client assets (with .br/.gz copies from
 *                           scripts/precompress.mjs; see static-files.mjs)
 *
 * Env:
 *   PORT      (default 3000)
 *   HOST      (default 0.0.0.0)
 *   PUBLIC_DIR (default /app/dist/client)
 *   SERVER_ENTRY (default /app/dist/server/server.js)
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { serveStatic } from "./static-files.mjs";

// Build stamp written by the Dockerfile (VITE_APP_VERSION / _COMMIT / _BUILD_TIME).
// Exposed to the SSR bundle as APP_VERSION / APP_COMMIT / APP_BUILD_TIME.
try {
  if (existsSync("./.env.build")) {
    for (const line of readFileSync("./.env.build", "utf8").split("\n")) {
      const m = /^VITE_APP_(VERSION|COMMIT|BUILD_TIME)=(.*)$/.exec(line.trim());
      if (m && !process.env[`APP_${m[1]}`]) process.env[`APP_${m[1]}`] = m[2];
    }
  }
} catch {}

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_DIR = resolve(process.env.PUBLIC_DIR ?? "/app/dist/client");
const SERVER_ENTRY = resolve(process.env.SERVER_ENTRY ?? "/app/dist/server/server.js");

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
    if (await serveStatic(req, res, PUBLIC_DIR)) return;
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