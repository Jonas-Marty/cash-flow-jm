import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";
import {
  transactionInputSchema,
  normalizeTransactionInput,
} from "@/lib/transactionSchema";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export const Route = createFileRoute("/api/public/transactions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = transactionInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const payload = normalizeTransactionInput(parsed.data);

        // Verify referenced accounts/category belong to this user — RLS would
        // catch cross-tenant access, but supabaseAdmin bypasses RLS, so we
        // enforce ownership explicitly here.
        const accountIds = [payload.source_account_id, payload.destination_account_id].filter(
          (v): v is string => !!v,
        );
        const { data: accs, error: accErr } = await supabaseAdmin
          .from("accounts")
          .select("id, user_id")
          .in("id", accountIds);
        if (accErr) return json({ error: "Database error" }, 500);
        if (!accs || accs.length !== accountIds.length || accs.some((a) => a.user_id !== auth.userId)) {
          return json({ error: "Account not found" }, 404);
        }
        if (payload.category_id) {
          const { data: cat, error: catErr } = await supabaseAdmin
            .from("categories")
            .select("id, user_id")
            .eq("id", payload.category_id)
            .maybeSingle();
          if (catErr) return json({ error: "Database error" }, 500);
          if (!cat || cat.user_id !== auth.userId) {
            return json({ error: "Category not found" }, 404);
          }
        }

        const { data: ins, error: insErr } = await supabaseAdmin
          .from("transactions")
          .insert({ ...payload, user_id: auth.userId })
          .select(
            "id, occurred_on, amount, destination_amount, type, source_account_id, destination_account_id, category_id, description, note, created_at",
          )
          .single();
        if (insErr) {
          log.error({ event: "api.public.transactions.db_error", err: insErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ transaction: ins }, 201);
      },
    },
  },
});