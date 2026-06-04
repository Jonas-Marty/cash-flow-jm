import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AIConversationSummary, AISettings, AssistantAction, ChatMessage } from "@/lib/ai/types";

// ---------- Settings ----------

export const getAISettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AISettings> => {
    const { userId } = context;
    const { data } = await supabaseAdmin
      .from("ai_credentials")
      .select("enabled, base_url, model, api_token")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      enabled: !!data?.enabled,
      base_url: data?.base_url ?? null,
      model: data?.model ?? null,
      has_token: !!data?.api_token,
    };
  });

const settingsSchema = z.object({
  enabled: z.boolean(),
  base_url: z.string().trim().url().max(500).nullable(),
  model: z.string().trim().min(1).max(120).nullable(),
  // Empty string means "leave existing"; null means "clear".
  api_token: z.string().max(1000).nullable().optional(),
});

export const saveAISettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }): Promise<AISettings> => {
    const { saveCredentials } = await import("./ai.server");
    const { userId } = context;
    await saveCredentials(userId, {
      enabled: data.enabled,
      base_url: data.base_url,
      model: data.model,
      api_token: data.api_token === undefined || data.api_token === "" ? undefined : data.api_token,
    });
    const { data: row } = await supabaseAdmin
      .from("ai_credentials")
      .select("enabled, base_url, model, api_token")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      enabled: !!row?.enabled,
      base_url: row?.base_url ?? null,
      model: row?.model ?? null,
      has_token: !!row?.api_token,
    };
  });

export const testAIConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        base_url: z.string().url(),
        model: z.string().min(1),
        api_token: z.string().min(1).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { testConnection, loadCredentials } = await import("./ai.server");
    const token = data.api_token && data.api_token.length > 0
      ? data.api_token
      : (await loadCredentials(context.userId).catch(() => null))?.api_token;
    if (!token) return { ok: false, error: "No token provided or stored." };
    return testConnection(data.base_url, token, data.model);
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

    const result = await runChat(creds, supabase, userId, sys, history);

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