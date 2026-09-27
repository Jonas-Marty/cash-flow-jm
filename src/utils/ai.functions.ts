import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  AIAction,
  AIActionBinding,
  AIConversationSummary,
  AIEndpoint,
  AIEndpointHealth,
  AssistantAction,
  ChatAttachmentRef,
  ChatMessage,
  ChatNotice,
} from "@/lib/ai/types";
import { AI_ACTIONS } from "@/lib/ai/types";

/**
 * A connection that was just switched on or assigned may be the one that was
 * missing while pending rows piled up unplaced. Drain them now rather than
 * waiting for the next notification or page visit. Best effort.
 */
function drainPendingSuggestions(userId: string): void {
  void import("./pending.enrich.server")
    .then(({ enrichPending }) => enrichPending(userId))
    .catch(() => {});
}

// ---------- Connections (endpoints) ----------

const actionSchema = z.enum(AI_ACTIONS as unknown as [AIAction, ...AIAction[]]);

async function readEndpoints(userId: string): Promise<AIEndpoint[]> {
  const { data, error } = await supabaseAdmin
    .from("ai_endpoints")
    .select(
      "id, name, base_url, model, extra_models, enabled, priority, api_token, context_level, transcribe_model, health_mode, capabilities, created_at",
    )
    .eq("user_id", userId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    base_url: r.base_url,
    model: r.model,
    extra_models: Array.isArray(r.extra_models) ? r.extra_models : [],
    enabled: !!r.enabled,
    priority: r.priority ?? 100,
    context_level: (r.context_level ?? "compact") as AIEndpoint["context_level"],
    transcribe_model: r.transcribe_model ?? null,
    health_mode: (r.health_mode ?? "real") as AIEndpoint["health_mode"],
    has_token: !!r.api_token,
    capabilities:
      r.capabilities && typeof r.capabilities === "object" && !Array.isArray(r.capabilities) ? r.capabilities : {},
  }));
}

/**
 * Probe tool calling and vision for one model of a connection and remember
 * the result. Runs after a save that changed the model, and from the settings
 * card's "Check capabilities" button.
 */
async function probeAndStore(userId: string, endpointId: string, model?: string | null) {
  const { loadEndpointRows, probeCapabilities, saveCapabilities } = await import("./ai.server");
  const row = (await loadEndpointRows(userId)).find((r) => r.id === endpointId);
  if (!row) throw new Error("Connection not found.");
  const m = model || row.model;
  const res = await probeCapabilities(row.base_url, row.api_token, m);
  // A fresh probe replaces the old verdict, also with "unknown": a stale
  // false would otherwise keep tools switched off for a model that has them.
  await saveCapabilities(userId, endpointId, m, { tools: res.tools, vision: res.vision });
  return res;
}

export const probeAIEndpointCapabilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), model: z.string().trim().max(120).nullable().optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ endpoints: AIEndpoint[]; errors: string[] }> => {
    const res = await probeAndStore(context.userId, data.id, data.model ?? null);
    return { endpoints: await readEndpoints(context.userId), errors: res.errors.slice(0, 3) };
  });

export const listAIEndpoints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ endpoints: AIEndpoint[]; bindings: AIActionBinding[] }> => {
    const { userId } = context;
    const endpoints = await readEndpoints(userId);
    const { data: rows } = await supabaseAdmin
      .from("ai_action_endpoints")
      .select("action, endpoint_id, allow_fallback, model")
      .eq("user_id", userId);
    const bindings: AIActionBinding[] = AI_ACTIONS.map((action) => {
      const row = (rows || []).find((r: any) => r.action === action);
      return {
        action,
        endpoint_id: row?.endpoint_id ?? null,
        allow_fallback: row ? row.allow_fallback !== false : true,
        model: row?.model ?? null,
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
  // undefined = keep existing
  extra_models: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  enabled: z.boolean(),
  priority: z.number().int().min(0).max(1000).optional(),
  context_level: z.enum(["off", "compact", "full", "xl"]).optional(),
  transcribe_model: z.string().trim().max(120).nullable().optional(),
  health_mode: z.enum(["fast", "model_listed", "real"]).optional(),
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
      context_level: data.context_level ?? "compact",
      transcribe_model: data.transcribe_model ? data.transcribe_model : null,
      health_mode: data.health_mode ?? "real",
      updated_at: new Date().toISOString(),
      ...(data.extra_models === undefined
        ? {}
        : { extra_models: Array.from(new Set(data.extra_models)).filter((m) => m !== data.model) }),
      ...(data.api_token === undefined ? {} : { api_token: data.api_token === "" ? null : data.api_token }),
    };
    let savedId: string;
    let needsProbe = true;
    if (data.id) {
      const { data: before } = await supabaseAdmin
        .from("ai_endpoints")
        .select("model, base_url, capabilities")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      const caps = before?.capabilities;
      const known =
        caps && typeof caps === "object" && !Array.isArray(caps) ? (caps as Record<string, unknown>)[base.model] : undefined;
      needsProbe = !before || before.model !== base.model || before.base_url !== base.base_url || !known;
      const { error } = await supabaseAdmin.from("ai_endpoints").update(base).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      savedId = data.id;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("ai_endpoints")
        .insert({ ...base, user_id: userId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      savedId = inserted.id;
    }
    // In the background: learn whether the model can call tools and see images.
    if (data.enabled && needsProbe) void probeAndStore(userId, savedId).catch(() => {});
    if (data.enabled) drainPendingSuggestions(userId);
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
        // null or "" clears the override; undefined keeps whatever is stored.
        model: z.string().trim().max(120).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // The upsert replaces the whole row, so an omitted model has to be read
    // back rather than written as null — otherwise saving just the fallback
    // toggle would wipe the model. A model also names one model on one
    // connection, so clearing the connection clears the model with it.
    let model: string | null = null;
    if (data.endpoint_id !== null) {
      if (data.model === undefined) {
        const { data: existing } = await supabaseAdmin
          .from("ai_action_endpoints")
          .select("model")
          .eq("user_id", context.userId)
          .eq("action", data.action)
          .maybeSingle();
        model = existing?.model ?? null;
      } else {
        model = data.model?.trim() || null;
      }
    }
    const { error } = await supabaseAdmin.from("ai_action_endpoints").upsert(
      {
        user_id: context.userId,
        action: data.action,
        endpoint_id: data.endpoint_id,
        allow_fallback: data.allow_fallback,
        model,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,action" },
    );
    if (error) throw new Error(error.message);
    if (data.action === "pending_enrich") drainPendingSuggestions(context.userId);
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
        const res = await pingEndpoint(r.base_url, r.api_token, r.model, r.health_mode);
        return {
          id: r.id,
          ok: res.ok,
          latency_ms: res.latency_ms,
          error: res.error ?? null,
          probe: res.probe,
          degraded: !!res.degraded,
          checked_at: new Date().toISOString(),
        };
      }),
    );
    // The settings page probes on a timer, which makes this the moment a
    // local model that was off is first seen back — the case the rows
    // nobody could place have been waiting for.
    if (health.some((h) => h.ok && !h.degraded)) drainPendingSuggestions(context.userId);
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

/** List the models an OpenAI-compatible connection offers. */
export const listAIModels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        base_url: z.string().url(),
        api_token: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; models: string[]; error?: string }> => {
    const { listModels, loadEndpointRows } = await import("./ai.server");
    let token = data.api_token && data.api_token.length > 0 ? data.api_token : null;
    if (!token && data.id) {
      token = (await loadEndpointRows(context.userId)).find((r) => r.id === data.id)?.api_token ?? null;
    }
    return listModels(data.base_url, token);
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
        attachments: (Array.isArray(r.content?.attachments) ? r.content.attachments : []) as ChatAttachmentRef[],
        notices: (Array.isArray(r.content?.notices) ? r.content.notices : []) as ChatNotice[],
        created_at: r.created_at,
      }));
    return { messages };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { deleteConversationAttachments } = await import("./aiAttachments.server");
    await deleteConversationAttachments(context.supabase, data.id);
    const { error } = await context.supabase.from("ai_conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Chat ----------

const chatFileSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  file_type: z.string().max(120).nullable().optional(),
  // 15 MB of bytes is ~20 MB of base64.
  file_base64: z.string().min(8).max(21_000_000),
});

const chatSchema = z
  .object({
    conversation_id: z.string().uuid().nullable().optional(),
    message: z.string().trim().max(4000).default(""),
    persist: z.boolean().optional(),
    endpoint_id: z.string().uuid().nullable().optional(),
    attachments: z.array(chatFileSchema).max(3).optional(),
    /**
     * Earlier turns of a non-persisted (sidebar) chat. Without them a reply
     * like "yes, do it" would reach the model with nothing to refer to.
     */
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(20_000),
          attachment_ids: z.array(z.string().uuid()).max(3).optional(),
        }),
      )
      .max(40)
      .optional(),
  })
  .refine((d) => d.message.length > 0 || (d.attachments?.length ?? 0) > 0, {
    message: "Write a message or attach a file.",
  });

export const chat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => chatSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { handleChat } = await import("./chat.server");
    return handleChat(context.supabase, context.userId, data);
  });

/** Short-lived link to open an attached file from the chat. */
export const getAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { loadAttachments, AI_ATTACHMENT_BUCKET } = await import("./aiAttachments.server");
    const [a] = await loadAttachments(context.supabase, [data.id]);
    if (!a) throw new Error("Attachment not found (it may have been removed).");
    const { data: signed, error } = await context.supabase.storage
      .from(AI_ATTACHMENT_BUCKET)
      .createSignedUrl(a.storage_path, 300);
    if (error || !signed) throw new Error(error?.message ?? "Could not create a link.");
    return { url: signed.signedUrl };
  });

// ---------- Voice input (speech-to-text) ----------

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        audio_base64: z.string().min(16).max(20_000_000),
        mime_type: z.string().max(120).optional(),
        file_name: z.string().max(200).optional(),
        language: z.string().trim().min(2).max(5).nullable().optional(),
        duration_ms: z.number().int().nonnegative().nullable().optional(),
        endpoint_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ text: string; endpoint: { id: string; name: string; fell_back: boolean } }> => {
    const { runTranscription } = await import("./ai.server");
    const binary = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    const r = await runTranscription(context.userId, binary, {
      file_name: data.file_name,
      mime_type: data.mime_type,
      language: data.language ?? null,
      duration_ms: data.duration_ms ?? null,
      endpoint_id: data.endpoint_id ?? null,
    });
    return { text: r.text, endpoint: r.endpoint };
  });
