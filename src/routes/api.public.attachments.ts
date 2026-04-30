import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashToken } from "@/utils/api-tokens.server";
import { log } from "@/lib/logger";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const bodySchema = z.object({
  transaction_id: z.string().uuid(),
  link_url: z.string().url().max(2000),
  display_name: z.string().trim().min(1).max(255),
  source: z.string().trim().min(1).max(50).optional(),
});

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
  // best-effort touch of last_used_at
  void supabaseAdmin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);
  return { userId: data.user_id };
}

export const Route = createFileRoute("/api/public/attachments")({
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
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
        }
        const { transaction_id, link_url, display_name, source } = parsed.data;

        // Verify transaction belongs to the same user
        const { data: tx, error: txErr } = await supabaseAdmin
          .from("transactions")
          .select("id, user_id")
          .eq("id", transaction_id)
          .maybeSingle();
        if (txErr) return json({ error: "Database error" }, 500);
        if (!tx || tx.user_id !== auth.userId) return json({ error: "Transaction not found" }, 404);

        const { data: ins, error: insErr } = await supabaseAdmin
          .from("transaction_attachments")
          .insert({
            transaction_id,
            user_id: auth.userId,
            source: source ?? "nextcloud",
            display_name,
            link_url,
          })
          .select("id, transaction_id, link_url, display_name, source, added_at")
          .single();
        if (insErr) {
          log.error({ event: "api.public.attachments.db_error", err: insErr.message, userId: auth.userId });
          return json({ error: "Internal server error" }, 500);
        }
        return json({ attachment: ins }, 201);
      },
    },
  },
});