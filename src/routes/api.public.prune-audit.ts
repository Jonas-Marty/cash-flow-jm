import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";

/**
 * Audit log retention pruner.
 *
 * Call from your Coolify cron (e.g. nightly):
 *   curl -H "Authorization: Bearer $METRICS_TOKEN" https://<host>/api/public/prune-audit
 *
 * Reads AUDIT_RETENTION_DAYS env var (default 365). Reuses METRICS_TOKEN for auth
 * to keep the operator surface to a single secret.
 */
export const Route = createFileRoute("/api/public/prune-audit")({
  server: {
    handlers: {
      POST: async ({ request }) => prune(request),
      GET: async ({ request }) => prune(request),
    },
  },
});

async function prune(request: Request): Promise<Response> {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    return new Response("disabled: METRICS_TOKEN not set", { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (provided !== expected) return new Response("Unauthorized", { status: 401 });

  const days = Math.max(1, parseInt(process.env.AUDIT_RETENTION_DAYS ?? "365", 10) || 365);

  const { data, error } = await supabaseAdmin.rpc("prune_audit_logs", { p_keep_days: days });
  if (error) {
    log.error({ event: "audit.prune_failed", err: error.message, days });
    return new Response(`error: ${error.message}`, { status: 500 });
  }
  log.info({ event: "audit.pruned", deleted: data, days });
  return new Response(JSON.stringify({ deleted: data, retention_days: days }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}