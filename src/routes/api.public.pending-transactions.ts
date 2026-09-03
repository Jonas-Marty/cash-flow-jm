import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";
import {
  pendingTransactionInputSchema,
  normalizePendingTransactionInput,
} from "@/lib/pendingTransactionSchema";

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

const SELECT_COLS =
  "id, status, source_account_id, amount, type, occurred_on, destination_account_id, destination_amount, category_id, description, note, external_source, external_ref, external_info, confirmed_transaction_id, confirmed_at, rejected_at, reject_reason, created_at, updated_at";

export const Route = createFileRoute("/api/public/pending-transactions")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        let q = supabaseAdmin
          .from("pending_transactions")
          .select(SELECT_COLS)
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (status === "pending" || status === "confirmed" || status === "rejected") {
          q = q.eq("status", status);
        }
        const externalSource = url.searchParams.get("external_source");
        if (externalSource) q = q.eq("external_source", externalSource);
        // Comma-separated, so a client can ask about a whole batch at once.
        const externalRef = url.searchParams.get("external_ref");
        if (externalRef !== null) {
          const refs = [...new Set(externalRef.split(",").map((r) => r.trim()).filter(Boolean))];
          if (refs.length === 0) return json({ pending_transactions: [] });
          q = q.in("external_ref", refs.slice(0, 200));
        }
        const { data, error } = await q;
        if (error) {
          log.error({ event: "api.public.pending.db_error", err: error.message });
          return json({ error: "Database error" }, 500);
        }
        return json({ pending_transactions: data ?? [] });
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

        const parsed = pendingTransactionInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const payload = normalizePendingTransactionInput(parsed.data);

        // Verify referenced accounts/category belong to this user.
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

        // Idempotency: if (external_source, external_ref) is supplied and we
        // already have a row, return it instead of duplicating.
        if (payload.external_source && payload.external_ref) {
          const { data: existing } = await supabaseAdmin
            .from("pending_transactions")
            .select(SELECT_COLS)
            .eq("user_id", auth.userId)
            .eq("external_source", payload.external_source)
            .eq("external_ref", payload.external_ref)
            .maybeSingle();
          if (existing) {
            return json({ pending_transaction: existing, deduplicated: true }, 200);
          }
        }

        const { data: ins, error: insErr } = await supabaseAdmin
          .from("pending_transactions")
          .insert({ ...payload, user_id: auth.userId })
          .select(SELECT_COLS)
          .single();
        if (insErr) {
          log.error({ event: "api.public.pending.insert_error", err: insErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ pending_transaction: ins }, 201);
      },
      DELETE: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const externalSource = url.searchParams.get("external_source");
        const externalRef = url.searchParams.get("external_ref");

        let find = supabaseAdmin
          .from("pending_transactions")
          .select("id, status")
          .eq("user_id", auth.userId);
        if (id) {
          find = find.eq("id", id);
        } else if (externalSource && externalRef) {
          find = find.eq("external_source", externalSource).eq("external_ref", externalRef);
        } else {
          return json({ error: "Provide id, or external_source and external_ref" }, 400);
        }
        const { data: row, error: findErr } = await find.maybeSingle();
        if (findErr) {
          log.error({ event: "api.public.pending.delete_lookup_error", err: findErr.message });
          return json({ error: "Database error" }, 500);
        }
        if (!row) return json({ error: "Pending transaction not found" }, 404);
        // A confirmed row already produced a real transaction; deleting it here
        // would leave that transaction orphaned, so it has to be undone in the
        // web app first.
        if (row.status === "confirmed") {
          return json({ error: "Pending transaction already confirmed" }, 409);
        }

        const { error: delErr } = await supabaseAdmin
          .from("pending_transactions")
          .delete()
          .eq("id", row.id)
          .eq("user_id", auth.userId);
        if (delErr) {
          log.error({ event: "api.public.pending.delete_error", err: delErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ deleted: true, id: row.id });
      },
    },
  },
});