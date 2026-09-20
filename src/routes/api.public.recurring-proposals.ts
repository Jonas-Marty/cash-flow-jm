import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";
import {
  CLEARED_PROPOSAL,
  PROPOSAL_COLUMNS,
  pickOccurrenceForBill,
  recurringProposalInputSchema,
} from "@/lib/recurringProposal";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

const OCC_COLS = `id, rule_id, due_on, effective_on, status, transaction_id, ${PROPOSAL_COLUMNS}`;

type OccRow = {
  id: string;
  rule_id: string;
  due_on: string;
  effective_on: string;
  status: string;
  transaction_id: string | null;
  proposed_amount: number | null;
  proposed_occurred_on: string | null;
  proposal_source: string | null;
  proposal_ref: string | null;
  proposal_info: string | null;
  proposed_at: string | null;
};

function toProposal(o: OccRow, ruleName: string | undefined) {
  return {
    occurrence_id: o.id,
    recurring_rule_id: o.rule_id,
    rule_name: ruleName ?? null,
    due_on: o.due_on,
    effective_on: o.effective_on,
    status: o.status,
    transaction_id: o.transaction_id,
    amount: o.proposed_amount,
    occurred_on: o.proposed_occurred_on,
    external_source: o.proposal_source,
    external_ref: o.proposal_ref,
    proposed_at: o.proposed_at,
  };
}

/**
 * `recurring_occurrences` has no `user_id` — it is owned through its rule — and
 * this route runs as the service role, so every read is scoped by the caller's
 * rule ids first.
 */
async function rulesOf(userId: string): Promise<Map<string, string> | null> {
  const { data, error } = await supabaseAdmin
    .from("recurring_rules")
    .select("id, name")
    .eq("user_id", userId);
  if (error) {
    log.error({ event: "api.public.recurring_proposals.rules_error", err: error.message, userId });
    return null;
  }
  return new Map((data ?? []).map((r) => [r.id, r.name]));
}

export const Route = createFileRoute("/api/public/recurring-proposals")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const rules = await rulesOf(auth.userId);
        if (!rules) return json({ error: "Database error" }, 500);
        if (rules.size === 0) return json({ recurring_proposals: [] });

        const url = new URL(request.url);
        let q = supabaseAdmin
          .from("recurring_occurrences")
          .select(OCC_COLS)
          .in("rule_id", [...rules.keys()])
          .not("proposed_at", "is", null)
          .order("proposed_at", { ascending: false })
          .limit(200);
        const externalSource = url.searchParams.get("external_source");
        if (externalSource) q = q.eq("proposal_source", externalSource);
        // Comma-separated, so a client can ask about a whole batch at once.
        const externalRef = url.searchParams.get("external_ref");
        if (externalRef !== null) {
          const refs = [
            ...new Set(
              externalRef
                .split(",")
                .map((r) => r.trim())
                .filter(Boolean),
            ),
          ];
          if (refs.length === 0) return json({ recurring_proposals: [] });
          q = q.in("proposal_ref", refs.slice(0, 200));
        }
        const { data, error } = await q;
        if (error) {
          log.error({ event: "api.public.recurring_proposals.db_error", err: error.message });
          return json({ error: "Database error" }, 500);
        }
        return json({
          recurring_proposals: ((data ?? []) as OccRow[]).map((o) =>
            toProposal(o, rules.get(o.rule_id)),
          ),
        });
      },

      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const parsed = recurringProposalInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const input = parsed.data;

        const { data: rule, error: ruleErr } = await supabaseAdmin
          .from("recurring_rules")
          .select("id, name, user_id, archived, is_variable_amount, recurrence_interval")
          .eq("id", input.recurring_rule_id)
          .maybeSingle();
        if (ruleErr) return json({ error: "Database error" }, 500);
        if (!rule || rule.user_id !== auth.userId) {
          return json({ error: "Recurring rule not found", code: "rule_not_found" }, 404);
        }
        if (rule.archived) {
          return json({ error: "Recurring rule is archived", code: "rule_archived" }, 422);
        }
        // A fixed amount is the user's own statement of what the bill costs;
        // only rules that leave the amount open take one from outside.
        if (!rule.is_variable_amount) {
          return json(
            {
              error:
                "Recurring rule has a fixed amount; only variable-amount rules accept proposals",
              code: "fixed_amount",
            },
            422,
          );
        }

        // Idempotency: the same bill again (an outbox retry) returns what it
        // did the first time, whatever has happened to the occurrence since.
        const { data: existing, error: existErr } = await supabaseAdmin
          .from("recurring_occurrences")
          .select(OCC_COLS)
          .eq("rule_id", rule.id)
          .eq("proposal_source", input.external_source)
          .eq("proposal_ref", input.external_ref)
          .limit(1)
          .maybeSingle();
        if (existErr) return json({ error: "Database error" }, 500);
        if (existing) {
          return json(
            { recurring_proposal: toProposal(existing as OccRow, rule.name), deduplicated: true },
            200,
          );
        }

        const { data: occs, error: occErr } = await supabaseAdmin
          .from("recurring_occurrences")
          .select(OCC_COLS)
          .eq("rule_id", rule.id);
        if (occErr) return json({ error: "Database error" }, 500);
        const target = pickOccurrenceForBill(
          (occs ?? []) as OccRow[],
          input.occurred_on,
          rule.recurrence_interval,
        );
        if (!target) {
          return json(
            {
              error: `No scheduled entry of "${rule.name}" near ${input.occurred_on}`,
              code: "no_occurrence",
            },
            404,
          );
        }
        if (target.status !== "pending") return refuse(target, rule.name);

        const { data: updated, error: updErr } = await supabaseAdmin
          .from("recurring_occurrences")
          .update({
            proposed_amount: input.amount,
            proposed_occurred_on: input.occurred_on,
            proposal_source: input.external_source,
            proposal_ref: input.external_ref,
            proposal_info: input.external_info,
            proposed_at: new Date().toISOString(),
          })
          .eq("id", target.id)
          .eq("status", "pending")
          .select(OCC_COLS)
          .maybeSingle();
        if (updErr) {
          log.error({
            event: "api.public.recurring_proposals.update_error",
            err: updErr.message,
            userId: auth.userId,
          });
          return json({ error: "Internal server error" }, 500);
        }
        if (!updated) {
          // Posted or skipped between the read and the write.
          const { data: now } = await supabaseAdmin
            .from("recurring_occurrences")
            .select(OCC_COLS)
            .eq("id", target.id)
            .maybeSingle();
          if (now) return refuse(now as OccRow, rule.name);
          return json({ error: "Scheduled entry disappeared, try again" }, 409);
        }
        log.info({
          event: "api.public.recurring_proposals.proposed",
          userId: auth.userId,
          ruleId: rule.id,
          occurrenceId: target.id,
          replacedRef: target.proposal_ref ?? undefined,
        });
        return json({ recurring_proposal: toProposal(updated as OccRow, rule.name) }, 201);
      },

      DELETE: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const url = new URL(request.url);
        const occurrenceId = url.searchParams.get("occurrence_id");
        const externalSource = url.searchParams.get("external_source");
        const externalRef = url.searchParams.get("external_ref");
        if (!occurrenceId && !(externalSource && externalRef)) {
          return json({ error: "Provide occurrence_id, or external_source and external_ref" }, 400);
        }
        const rules = await rulesOf(auth.userId);
        if (!rules) return json({ error: "Database error" }, 500);
        if (rules.size === 0) return json({ error: "Proposal not found" }, 404);

        let find = supabaseAdmin
          .from("recurring_occurrences")
          .select(OCC_COLS)
          .in("rule_id", [...rules.keys()])
          .not("proposed_at", "is", null);
        find = occurrenceId
          ? find.eq("id", occurrenceId)
          : find.eq("proposal_source", externalSource!).eq("proposal_ref", externalRef!);
        const { data: row, error: findErr } = await find.limit(1).maybeSingle();
        if (findErr) {
          log.error({
            event: "api.public.recurring_proposals.delete_lookup_error",
            err: findErr.message,
          });
          return json({ error: "Database error" }, 500);
        }
        if (!row) return json({ error: "Proposal not found" }, 404);
        const occ = row as OccRow;
        // The proposal on a posted occurrence is the record of where the
        // transaction's numbers came from; the transaction has to be edited
        // in the web app instead.
        if (occ.status === "posted") {
          return json(
            {
              error: "Already posted — edit the transaction in the web app",
              code: "already_posted",
              recurring_proposal: toProposal(occ, rules.get(occ.rule_id)),
            },
            409,
          );
        }

        const { error: delErr } = await supabaseAdmin
          .from("recurring_occurrences")
          .update(CLEARED_PROPOSAL)
          .eq("id", occ.id)
          .neq("status", "posted");
        if (delErr) {
          log.error({
            event: "api.public.recurring_proposals.delete_error",
            err: delErr.message,
            userId: auth.userId,
          });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ deleted: true, occurrence_id: occ.id });
      },
    },
  },
});

/** A bill for an occurrence the user has already dealt with is not applied. */
function refuse(occ: OccRow, ruleName: string) {
  const posted = occ.status === "posted";
  return json(
    {
      error: posted
        ? `"${ruleName}" for ${occ.effective_on} is already posted — open the transaction and edit it by hand`
        : `"${ruleName}" for ${occ.effective_on} was skipped`,
      code: posted ? "already_posted" : "skipped",
      recurring_proposal: toProposal(occ, ruleName),
    },
    409,
  );
}
