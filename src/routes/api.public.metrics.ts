import { createFileRoute } from "@tanstack/react-router";
import { renderMetrics, auditEventsTotal } from "@/lib/metrics";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";

/**
 * Prometheus scrape endpoint.
 *
 * Auth: requires `Authorization: Bearer <METRICS_TOKEN>` (env var).
 * If METRICS_TOKEN is unset, the endpoint returns 503 — fail closed rather
 * than expose metrics by accident.
 *
 * Augments in-process counters with a few DB-derived gauges so dashboards
 * keep useful numbers across container restarts.
 */
export const Route = createFileRoute("/api/public/metrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const expected = process.env.METRICS_TOKEN;
        if (!expected) {
          return new Response("metrics disabled: METRICS_TOKEN not set", { status: 503 });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (provided.length === 0 || provided.length !== expected.length) {
          return new Response("Unauthorized", { status: 401 });
        }
        // Constant-time comparison
        let mismatch = 0;
        for (let i = 0; i < expected.length; i++) {
          mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
        }
        if (mismatch !== 0) return new Response("Unauthorized", { status: 401 });

        // Pull a few cheap DB-derived gauges so a fresh container has data immediately.
        const lines: string[] = [];
        try {
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { count: auditCount24h } = await supabaseAdmin
            .from("audit_logs")
            .select("*", { count: "exact", head: true })
            .gte("occurred_at", since);
          const { count: usersTotal } = await supabaseAdmin
            .from("user_roles")
            .select("*", { count: "exact", head: true });
          const { count: txTotal } = await supabaseAdmin
            .from("transactions")
            .select("*", { count: "exact", head: true });
          lines.push("# HELP app_audit_events_24h Audit events in the last 24h");
          lines.push("# TYPE app_audit_events_24h gauge");
          lines.push(`app_audit_events_24h ${auditCount24h ?? 0}`);
          lines.push("# HELP app_users_total Number of users with a role assigned");
          lines.push("# TYPE app_users_total gauge");
          lines.push(`app_users_total ${usersTotal ?? 0}`);
          lines.push("# HELP app_transactions_total Total transactions stored");
          lines.push("# TYPE app_transactions_total gauge");
          lines.push(`app_transactions_total ${txTotal ?? 0}`);
          // bump our own counter so /metrics itself shows non-zero traffic
          auditEventsTotal.inc({ source: "scrape" }, 0);
        } catch (err) {
          log.warn({ event: "metrics.gauges_failed", err });
        }

        const body = renderMetrics() + lines.join("\n") + (lines.length ? "\n" : "");
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
        });
      },
    },
  },
});