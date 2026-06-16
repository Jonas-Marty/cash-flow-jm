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

  const startedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin.rpc(
    "process_recurring_rules_for_all_users",
    { p_today: today },
  );
  if (error) {
    log.error({ event: "recurring.process_failed", err: error.message, today });
    return new Response(`error: ${error.message}`, { status: 500 });
  }
  log.info({ event: "recurring.processed", users: data, today });

  // Find all transactions auto-posted during this run and dispatch webhooks.
  // We use posted_at on recurring_occurrences as the authoritative marker so
  // we only notify for rows posted by THIS run (not prior pending rows that
  // happen to have a transaction_id from an earlier sweep).
  try {
    const { data: postedOccs } = await supabaseAdmin
      .from("recurring_occurrences")
      .select("transaction_id, posted_at, recurring_rules!inner(user_id)")
      .gte("posted_at", startedAt)
      .not("transaction_id", "is", null);
    type OccRow = { transaction_id: string | null; recurring_rules: { user_id: string } | { user_id: string }[] | null };
    const occs = (postedOccs ?? []) as OccRow[];
    const rows: Array<{ userId: string; txId: string }> = [];
    for (const o of occs) {
      if (!o.transaction_id) continue;
      const rr = Array.isArray(o.recurring_rules) ? o.recurring_rules[0] : o.recurring_rules;
      if (!rr?.user_id) continue;
      rows.push({ userId: rr.user_id, txId: o.transaction_id });
    }
    // Split groups: only the group leader is on the occurrence — also pick up
    // the rest by split_group_id.
    if (rows.length > 0) {
      const txIds = rows.map((r) => r.txId);
      const { data: leaders } = await supabaseAdmin
        .from("transactions")
        .select("split_group_id")
        .in("id", txIds)
        .not("split_group_id", "is", null);
      const groupIds = Array.from(new Set((leaders ?? []).map((l: { split_group_id: string | null }) => l.split_group_id).filter(Boolean) as string[]));
      if (groupIds.length > 0) {
        const { data: sibs } = await supabaseAdmin
          .from("transactions")
          .select("id, user_id, split_group_id")
          .in("split_group_id", groupIds);
        for (const s of (sibs ?? []) as Array<{ id: string; user_id: string }>) {
          if (!rows.some((r) => r.txId === s.id)) rows.push({ userId: s.user_id, txId: s.id });
        }
      }
    }
    if (rows.length > 0) {
      const { dispatchTransactionsCreated } = await import("@/lib/notifiers/dispatch.server");
      void dispatchTransactionsCreated("recurring", rows);
      log.info({ event: "recurring.dispatched", count: rows.length });
    }
  } catch (e) {
    log.error({ event: "recurring.dispatch_failed", err: e instanceof Error ? e.message : String(e) });
  }
  return new Response(JSON.stringify({ users_processed: data, today }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}