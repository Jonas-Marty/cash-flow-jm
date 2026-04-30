import { createStart, createMiddleware } from "@tanstack/react-start";
import { log, newRequestId } from "@/lib/logger";
import { requestsTotal, requestErrorsTotal, requestDurationMsSum } from "@/lib/metrics";

/**
 * Global request middleware.
 *
 * Runs for every server request (server functions, server routes, SSR).
 * Emits one structured JSON log line per request and updates Prometheus
 * counters consumed by /api/public/metrics.
 *
 * The userId is best-effort: we read the Authorization header and decode the
 * JWT payload without verifying its signature. Verification still happens in
 * `requireSupabaseAuth`; here we only want a label for logs/metrics.
 */
function bestEffortUserIdFromAuth(authHeader: string | null): string | undefined {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return undefined;
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = parts[1];
    // base64url -> base64
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const obj = JSON.parse(json) as { sub?: string };
    return typeof obj.sub === "string" ? obj.sub : undefined;
  } catch {
    return undefined;
  }
}

const requestLogger = createMiddleware().server(async ({ next, request }) => {
  const started = Date.now();
  const requestId = newRequestId();
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;
  const ua = request.headers.get("user-agent") ?? undefined;
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    undefined;
  const userId = bestEffortUserIdFromAuth(request.headers.get("authorization"));

  // Skip noisy assets — keep logs focused on app traffic.
  const noisy = path.startsWith("/_build/") || path.startsWith("/assets/") || /\.(js|css|map|png|jpg|svg|ico|woff2?|webp)$/i.test(path);

  try {
    const result = await next();
    const durationMs = Date.now() - started;
    if (!noisy) {
      const status = 200; // request middleware doesn't see the final status; downstream may set it
      requestsTotal.inc({ method, path });
      requestDurationMsSum.inc({ method, path }, durationMs);
      log.info({
        event: "request",
        requestId,
        method,
        path,
        status,
        durationMs,
        userId,
        ip,
        ua,
      });
    }
    return result;
  } catch (err) {
    const durationMs = Date.now() - started;
    const status = err instanceof Response ? err.status : 500;
    requestsTotal.inc({ method, path });
    requestErrorsTotal.inc({ method, path, status: String(status) });
    requestDurationMsSum.inc({ method, path }, durationMs);
    log.error({
      event: "request.error",
      requestId,
      method,
      path,
      status,
      durationMs,
      userId,
      ip,
      ua,
      err,
    });
    throw err;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [requestLogger],
}));