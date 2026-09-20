import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authenticate(request: Request): Promise<{ userId: string } | null> {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const raw = auth.slice("Bearer ".length).trim();
  if (!raw) return null;
  const token_hash = hashToken(raw);
  const { data, error } = await supabaseAdmin
    .from("api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", token_hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  void supabaseAdmin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { userId: data.user_id };
}

/**
 * Recurring rules, for a client that wants to point something at one — the
 * phone's rule editor picks the rule a bill notification fills in. Only
 * variable-amount rules take a bill proposal; `accepts_proposals` says so, so
 * the client does not have to know that business rule.
 */
export const Route = createFileRoute("/api/public/recurring-rules")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        const url = new URL(request.url);
        const includeArchived = url.searchParams.get("include_archived") === "true";

        let q = supabaseAdmin
          .from("recurring_rules")
          .select(
            "id, name, type, amount, estimated_amount, is_variable_amount, is_variable_date, auto_post, source_account_id, category_id, recurrence_interval, starts_on, ends_on, archived",
          )
          .eq("user_id", auth.userId)
          .order("name");
        if (!includeArchived) q = q.eq("archived", false);

        const { data: rules, error } = await q;
        if (error) {
          log.error({
            event: "api.public.recurring_rules.db_error",
            err: error.message,
            userId: auth.userId,
          });
          return json({ error: "Internal server error" }, 500);
        }
        const ids = (rules ?? []).map((r) => r.id);

        const next = new Map<string, { due_on: string; effective_on: string }>();
        if (ids.length > 0) {
          const { data: occs, error: occErr } = await supabaseAdmin
            .from("recurring_occurrences")
            .select("rule_id, due_on, effective_on")
            .in("rule_id", ids)
            .eq("status", "pending")
            .order("effective_on", { ascending: true });
          if (occErr) {
            log.error({
              event: "api.public.recurring_rules.occ_error",
              err: occErr.message,
              userId: auth.userId,
            });
            return json({ error: "Internal server error" }, 500);
          }
          for (const o of occs ?? []) {
            if (!next.has(o.rule_id))
              next.set(o.rule_id, { due_on: o.due_on, effective_on: o.effective_on });
          }
        }

        return json({
          recurring_rules: (rules ?? []).map((r) => ({
            ...r,
            accepts_proposals: r.is_variable_amount && !r.archived,
            next_pending_occurrence: next.get(r.id) ?? null,
          })),
        });
      },
    },
  },
});
