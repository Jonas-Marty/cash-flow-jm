import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";

/**
 * Recurring rules processor — bulk, all users.
 *
 * Triggered by a host-level cron (e.g. on the Coolify server) once or twice a day:
 *   curl -fsS -X POST -H "Authorization: Bearer $METRICS_TOKEN" \
 *        https://<app-host>/api/public/process-recurring
 *
 * Runs the auto-post promotion + look-ahead materialisation for every user
 * that owns at least one active recurring rule. Reuses METRICS_TOKEN to keep
 * the operator surface to a single secret.
 */
export const Route = createFileRoute("/api/public/process-recurring")({
  server: {
    handlers: {
      POST: async ({ request }) => run(request),
      GET: async ({ request }) => run(request),
    },
  },
});

async function run(request: Request): Promise<Response> {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    return new Response("disabled: METRICS_TOKEN not set", { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (provided !== expected) return new Response("Unauthorized", { status: 401 });

  // Use server's local date. Operators can override via ?today=YYYY-MM-DD for backfills.
  const url = new URL(request.url);
  const override = url.searchParams.get("today");
  const today = override && /^\d{4}-\d{2}-\d{2}$/.test(override)
    ? override
    : new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin.rpc(
    "process_recurring_rules_for_all_users",
    { p_today: today },
  );
  if (error) {
    log.error({ event: "recurring.process_failed", err: error.message, today });
    return new Response(`error: ${error.message}`, { status: 500 });
  }
  log.info({ event: "recurring.processed", users: data, today });
  return new Response(JSON.stringify({ users_processed: data, today }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}