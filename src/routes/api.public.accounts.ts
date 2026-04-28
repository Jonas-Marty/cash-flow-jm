import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";

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

export const Route = createFileRoute("/api/public/accounts")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth) return json({ error: "Unauthorized" }, 401);

        const url = new URL(request.url);
        const includeArchived = url.searchParams.get("include_archived") === "true";

        let q = supabaseAdmin
          .from("accounts")
          .select("id, name, type, archived, currency_code, currency_symbol")
          .eq("user_id", auth.userId)
          .order("type")
          .order("name");
        if (!includeArchived) q = q.eq("archived", false);

        const { data, error } = await q;
        if (error) {
          console.error("[api.public.accounts] DB error:", error.message);
          return json({ error: "Internal server error" }, 500);
        }
        return json({ accounts: data ?? [] });
      },
    },
  },
});