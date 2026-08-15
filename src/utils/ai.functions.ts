import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  AIAction,
  AIActionBinding,
  AIConversationSummary,
  AIEndpoint,
  AIEndpointHealth,
  AssistantAction,
  ChatMessage,
} from "@/lib/ai/types";
import { AI_ACTIONS } from "@/lib/ai/types";

// ---------- Connections (endpoints) ----------

const actionSchema = z.enum(AI_ACTIONS as unknown as [AIAction, ...AIAction[]]);

async function readEndpoints(userId: string): Promise<AIEndpoint[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_endpoints")
    .select("id, name, base_url, model, enabled, priority, api_token, created_at")
    .eq("user_id", userId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    base_url: r.base_url,
    model: r.model,
    enabled: !!r.enabled,
    priority: r.priority ?? 100,
    has_token: !!r.api_token,
  }));
}

export const listAIEndpoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ endpoints: AIEndpoint[]; bindings: AIActionBinding[] }> => {
    const { userId } = context;
    const endpoints = await readEndpoints(userId);
    const { data: rows } = await supabaseAdmin
      .from("ai_action_endpoints")
      .select("action, endpoint_id, allow_fallback")
      .eq("user_id", userId);
    const bindings: AIActionBinding[] = AI_ACTIONS.map((action) => {
      const row = (rows || []).find((r: any) => r.action === action);
      return {
        action,
        endpoint_id: row?.endpoint_id ?? null,
        allow_fallback: row ? row.allow_fallback !== false : true,
      };
    });
    return { endpoints, bindings };
  });

const endpointSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(80),
  base_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v), { message: "base_url must be a http(s) URL" }),
  model: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(1000).optional(),
  // undefined = keep existing, "" = clear
  api_token: z.string().max(1000).optional(),
});

export const saveAIEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => endpointSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ endpoints: AIEndpoint[] }> => {
    const { userId } = context;
    const base = {
      name: data.name,
      base_url: data.base_url.replace(/\/+$/, ""),
      model: data.model,
      enabled: data.enabled,
      priority: data.priority ?? 100,
      updated_at: new Date().toISOString(),
      ...(data.api_token === undefined ? {} : { api_token: data.api_token === "" ? null : data.api_token }),
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("ai_endpoints").update(base).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("ai_endpoints").insert({ ...base, user_id: userId });
      if (error) throw new Error(error.message);
    }
    return { endpoints: await readEndpoints(userId) };
  });

export const deleteAIEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ endpoints: AIEndpoint[] }> => {
    const { error } = await supabaseAdmin
      .from("ai_endpoints")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { endpoints: await readEndpoints(context.userId) };
  });

export const saveAIActionBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: actionSchema,
        endpoint_id: z.string().uuid().nullable(),
        allow_fallback: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.from("ai_action_endpoints").upsert(
      {
        user_id: context.userId,
        action: data.action,
        endpoint_id: data.endpoint_id,
        allow_fallback: data.allow_fallback,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,action" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Availability probe for every configured connection (or a single one). */
export const checkAIEndpoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional() }).optional().parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ health: AIEndpointHealth[] }> => {
    const { loadEndpointRows, pingEndpoint } = await import("./ai.server");
    const rows = (await loadEndpointRows(context.userId)).filter((r) => !data?.id || r.id === data.id);
    const health = await Promise.all(
      rows.map(async (r): Promise<AIEndpointHealth> => {
        const res = await pingEndpoint(r.base_url, r.api_token, r.model);
        return { id: r.id, ok: res.ok, latency_ms: res.latency_ms, error: res.error ?? null };
      }),
    );
    return { health };
  });

/** Test an unsaved / edited connection form. */
export const testAIConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        base_url: z.string().url(),
        model: z.string().min(1),
        api_token: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { testConnection, loadEndpointRows } = await import("./ai.server");
    let token = data.api_token && data.api_token.length > 0 ? data.api_token : null;
    if (!token && data.id) {
      token = (await loadEndpointRows(context.userId)).find((r) => r.id === data.id)?.api_token ?? null;
    }
    return testConnection(data.base_url, token ?? "", data.model);
  });

// ---------- Conversations ----------

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ conversations: AIConversationSummary[] }> => {
    const { data, error } = await context.supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { conversations: (data || []) as AIConversationSummary[] };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ messages: ChatMessage[] }> => {
    const { data: rows, error } = await context.supabase
      .from("ai_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const messages: ChatMessage[] = (rows || [])
      .filter((r: any) => r.role === "user" || r.role === "assistant")
      .map((r: any) => ({
        id: r.id,
        role: r.role,
        text: (r.content && typeof r.content === "object" ? r.content.text : "") || "",
        action: (r.content && typeof r.content === "object" ? r.content.action ?? null : null) as AssistantAction | null,
        created_at: r.created_at,
      }));
    return { messages };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Chat ----------

const chatSchema = z.object({
  conversation_id: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  persist: z.boolean().optional(),
});

export const chat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => chatSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { loadCredentials, runChat } = await import("./ai.server");
    const { userId, supabase } = context;
    const creds = await loadCredentials(userId);

    // Settings for system prompt context.
    const { data: settings } = await supabase.from("settings").select("currency_code, currency_symbol, language").maybeSingle();
    const sys = {
      currencyCode: settings?.currency_code || "CHF",
      currencySymbol: settings?.currency_symbol || "CHF",
      todayISO: new Date().toISOString().slice(0, 10),
      language: settings?.language || "de",
    };

    // Load existing history if persistent.
    let conversationId = data.conversation_id ?? null;
    let history: { role: "user" | "assistant" | "tool"; content: string }[] = [];
    if (data.persist) {
      if (!conversationId) {
        const title = data.message.slice(0, 60);
        const { data: conv, error } = await supabase
          .from("ai_conversations")
          .insert({ user_id: userId, title })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        conversationId = conv.id;
      } else {
        const { data: rows } = await supabase
          .from("ai_messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true });
        for (const r of (rows || []) as any[]) {
          if (r.role !== "user" && r.role !== "assistant") continue;
          const text = (r.content && typeof r.content === "object" ? r.content.text : "") || "";
          history.push({ role: r.role, content: text });
        }
      }
      // Persist the user message.
      await supabase
        .from("ai_messages")
        .insert({ conversation_id: conversationId, user_id: userId, role: "user", content: { text: data.message } });
    }
    history.push({ role: "user", content: data.message });

    const result = await runChat(creds, supabase, userId, sys, history, conversationId);

    if (data.persist && conversationId) {
      await supabase.from("ai_messages").insert({
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: { text: result.text, action: result.action },
      });
      await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    }

    return {
      conversation_id: conversationId,
      message: { role: "assistant" as const, text: result.text, action: result.action },
    };
  });