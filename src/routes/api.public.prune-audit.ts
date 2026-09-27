import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";

/**
 * Audit log retention pruner. Also removes chat attachments not linked to a
 * conversation after 7 days.
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

  // Chat attachments that belong to no conversation (sidebar chat, deleted
  // conversation) are only needed while that chat is open.
  let attachmentsDeleted: number | null = null;
  try {
    const { pruneUnlinkedAttachments } = await import("@/utils/aiAttachments.server");
    attachmentsDeleted = await pruneUnlinkedAttachments();
    log.info({ event: "ai_attachments.pruned", deleted: attachmentsDeleted });
  } catch (e) {
    log.error({ event: "ai_attachments.prune_failed", err: e instanceof Error ? e.message : String(e) });
  }
  return new Response(JSON.stringify({ deleted: data, retention_days: days, attachments_deleted: attachmentsDeleted }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}