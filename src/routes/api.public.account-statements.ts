import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";

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

const RECONCILE_CATEGORY_NAME = "Reconciliation adjustment";

const postSchema = z.object({
  account_id: z.string().uuid(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statement_balance: z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "statement_balance must be a number" });
      return z.NEVER;
    }
    return Math.round(n * 100) / 100;
  }),
  source: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_.:-]+$/).optional(),
  external_ref: z.string().max(255).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  auto_compensate: z.boolean().optional(),
});

async function computeBalance(userId: string, accountId: string, asOf: string): Promise<number> {
  // Use the same RPC the UI uses, but run it as the user via a Supabase client
  // anchored on supabaseAdmin (RPC honors user_id since we filter explicitly
  // by ownership below). Simplest: call RPC and filter by account+user.
  const { data, error } = await supabaseAdmin.rpc("account_balances_as_of", { p_date: asOf });
  if (error) throw error;
  // The RPC returns rows for *all* users when called with the admin client.
  // Filter by account_id (which we've already validated belongs to user).
  const row = (data as Array<{ id: string; balance: number }>).find((r) => r.id === accountId);
  return row ? Number(row.balance) : 0;
}

async function ensureReconcileCategory(userId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", RECONCILE_CATEGORY_NAME)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: ins, error: insErr } = await supabaseAdmin
    .from("categories")
    .insert({ name: RECONCILE_CATEGORY_NAME, user_id: userId })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return ins.id as string;
}

export const Route = createFileRoute("/api/public/account-statements")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        const url = new URL(request.url);
        const accountId = url.searchParams.get("account_id");
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");

        let q = supabaseAdmin
          .from("account_statements")
          .select("*")
          .eq("user_id", auth.userId)
          .order("as_of", { ascending: false });
        if (accountId) q = q.eq("account_id", accountId);
        if (from) q = q.gte("as_of", from);
        if (to) q = q.lte("as_of", to);

        const { data, error } = await q.limit(500);
        if (error) {
          log.error({ event: "api.public.account_statements.list_err", err: error.message });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ statements: data ?? [] });
      },

      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
        const parsed = postSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const p = parsed.data;

        // Verify account belongs to user.
        const { data: acc, error: accErr } = await supabaseAdmin
          .from("accounts")
          .select("id, user_id")
          .eq("id", p.account_id)
          .maybeSingle();
        if (accErr) return json({ error: "Database error" }, 500);
        if (!acc || acc.user_id !== auth.userId) return json({ error: "Account not found" }, 404);

        const row = {
          user_id: auth.userId,
          account_id: p.account_id,
          as_of: p.as_of,
          statement_balance: p.statement_balance,
          source: p.source ?? "api",
          external_ref: p.external_ref ?? null,
          note: p.note ?? null,
        };
        const { data: stmt, error: upErr } = await supabaseAdmin
          .from("account_statements")
          .upsert(row, { onConflict: "account_id,as_of,source" })
          .select("*")
          .single();
        if (upErr) {
          log.error({ event: "api.public.account_statements.upsert_err", err: upErr.message });
          return json({ error: "Internal server error" }, 500);
        }

        const computed = await computeBalance(auth.userId, p.account_id, p.as_of);
        const diff = Math.round((Number(stmt.statement_balance) - computed) * 100) / 100;

        let result = { ...stmt, computed_balance: computed, diff };

        if (p.auto_compensate && Math.abs(diff) >= 0.005) {
          // Remove prior compensation if present, then post a fresh one.
          if (stmt.compensation_transaction_id) {
            await supabaseAdmin.from("transactions").delete().eq("id", stmt.compensation_transaction_id);
          }
          const categoryId = await ensureReconcileCategory(auth.userId);
          const type = diff > 0 ? "income" : "expense";
          const amount = Math.abs(diff);
          const { data: tx, error: txErr } = await supabaseAdmin
            .from("transactions")
            .insert({
              occurred_on: p.as_of,
              amount,
              type,
              source_account_id: p.account_id,
              category_id: categoryId,
              description: "Reconciliation adjustment",
              user_id: auth.userId,
            })
            .select("id")
            .single();
          if (txErr) {
            log.error({ event: "api.public.account_statements.comp_err", err: txErr.message });
            return json({ error: "Failed to post compensation" }, 500);
          }
          const { data: updated } = await supabaseAdmin
            .from("account_statements")
            .update({ status: "compensated", compensation_transaction_id: tx.id })
            .eq("id", stmt.id)
            .select("*")
            .single();
          result = { ...(updated ?? stmt), computed_balance: computed, diff };
        } else if (Math.abs(diff) < 0.005 && stmt.status !== "matched") {
          const { data: updated } = await supabaseAdmin
            .from("account_statements")
            .update({ status: "matched", compensation_transaction_id: null })
            .eq("id", stmt.id)
            .select("*")
            .single();
          result = { ...(updated ?? stmt), computed_balance: computed, diff };
        }

        return json({ statement: result }, 201);
      },

      DELETE: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id query param required" }, 400);
        const deleteComp = url.searchParams.get("delete_compensation") === "true";

        const { data: stmt, error: selErr } = await supabaseAdmin
          .from("account_statements")
          .select("id, user_id, compensation_transaction_id")
          .eq("id", id)
          .maybeSingle();
        if (selErr) return json({ error: "Database error" }, 500);
        if (!stmt || stmt.user_id !== auth.userId) return json({ error: "Not found" }, 404);

        if (deleteComp && stmt.compensation_transaction_id) {
          await supabaseAdmin.from("transactions").delete().eq("id", stmt.compensation_transaction_id);
        }
        const { error: delErr } = await supabaseAdmin
          .from("account_statements")
          .delete()
          .eq("id", id);
        if (delErr) return json({ error: "Internal server error" }, 500);
        return json({ ok: true });
      },
    },
  },
});