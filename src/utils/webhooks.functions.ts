import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/client-auth-middleware";

const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((u) => {
    try {
      const parsed = new URL(u);
      if (parsed.protocol === "https:") return true;
      if (parsed.protocol === "http:") {
        // Allow http only for localhost / private dev targets.
        return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname);
      }
      return false;
    } catch {
      return false;
    }
  }, "URL must use https:// (http:// allowed only for localhost)");

const payloadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: urlSchema,
  auth_header_name: z.string().trim().max(100).optional().nullable(),
  auth_header_value: z.string().max(2000).optional().nullable(),
  active: z.boolean().optional(),
});

export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("webhooks")
      .select("id, name, url, auth_header_name, active, events, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { webhooks: data ?? [] };
  });

export const createWebhook = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) => payloadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("webhooks")
      .insert({
        user_id: userId,
        name: data.name,
        url: data.url,
        auth_header_name: data.auth_header_name?.trim() || null,
        auth_header_value: data.auth_header_value || null,
        active: data.active ?? true,
      })
      .select("id, name, url, auth_header_name, active, events, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { webhook: row };
  });

export const updateWebhook = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        patch: payloadSchema.partial(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const p = data.patch;
    const update: {
      name?: string;
      url?: string;
      auth_header_name?: string | null;
      auth_header_value?: string | null;
      active?: boolean;
    } = {};
    if (p.name !== undefined) update.name = p.name;
    if (p.url !== undefined) update.url = p.url;
    if (p.auth_header_name !== undefined)
      update.auth_header_name = p.auth_header_name?.trim() || null;
    if (p.auth_header_value !== undefined)
      update.auth_header_value = p.auth_header_value || null;
    if (p.active !== undefined) update.active = p.active;
    const { error } = await supabase.from("webhooks").update(update).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("webhooks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Send a synthetic test event to a webhook. Useful for n8n connection check.
 * Loads the most recent transaction of the user (or sends a placeholder).
 */
export const testWebhook = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify ownership (defence in depth — RLS already enforces this)
    const { data: wh, error } = await supabase
      .from("webhooks")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!wh) throw new Error("Webhook not found");

    const { webhookNotifier } = await import("@/lib/notifiers/webhook.server");
    const { eventNameForSource } = await import("@/lib/notifiers/types");
    await webhookNotifier.deliver(userId, {
      event: eventNameForSource("manual"),
      delivered_at: new Date().toISOString(),
      delivery_id: "test-" + Math.random().toString(36).slice(2, 10),
      transaction: {
        id: "00000000-0000-0000-0000-000000000000",
        occurred_on: new Date().toISOString().slice(0, 10),
        amount: 12.34,
        destination_amount: null,
        type: "expense",
        source_account_id: null,
        destination_account_id: null,
        category_id: null,
        description: "Webhook test event",
        note: "#test",
        tags: ["test"],
        split_group_id: null,
        recurring_rule_id: null,
        created_at: new Date().toISOString(),
      },
    });
    return { ok: true };
  });

/**
 * Client-callable trigger used by the in-app Add transaction flow (which
 * inserts via the browser supabase client). The server fn verifies the
 * transaction belongs to the caller, then dispatches notifiers.
 */
export const notifyTransactionCreated = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: { ids: string[] }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // RLS limits this to the caller's own transactions.
    const { data: rows, error } = await supabase
      .from("transactions")
      .select("id")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return { dispatched: 0 };
    const { dispatchTransactionCreated } = await import("@/lib/notifiers/dispatch.server");
    // Fire and forget — don't block the response.
    void Promise.all(ids.map((id) => dispatchTransactionCreated(userId, "manual", id)));
    return { dispatched: ids.length };
  });