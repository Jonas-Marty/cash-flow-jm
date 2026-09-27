// Server-only: one assistant chat turn (attachments, history, tool loop, persistence).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAttachmentRef } from "@/lib/ai/types";
import {
  ATTACHMENT_CHARS_CURRENT,
  ATTACHMENT_CHARS_HISTORY,
  formatAttachmentBlock,
  userTurnText,
} from "@/lib/ai/attachmentTurn";
import { capsFor, resolveEndpoint, runChat, type ChatResult, type ChatTurn } from "./ai.server";
import { attachmentBase64, loadAttachments, storeAttachment, toRef } from "./aiAttachments.server";

/** Images sent to the model per request; older ones are described by name only. */
const MAX_IMAGES_PER_REQUEST = 3;

export interface ChatRequest {
  conversation_id?: string | null;
  message: string;
  persist?: boolean;
  endpoint_id?: string | null;
  attachments?: { file_name: string; file_type?: string | null; file_base64: string }[];
  history?: { role: "user" | "assistant"; text: string; attachment_ids?: string[] }[];
}

export interface ChatResponse {
  conversation_id: string | null;
  attachments: ChatAttachmentRef[];
  message: {
    role: "assistant";
    text: string;
    action: ChatResult["action"];
    usage: ChatResult["usage"] | null;
    notices: ChatResult["notices"];
  };
  endpoint: { id: string; name: string; fell_back: boolean };
}

export async function handleChat(supabase: SupabaseClient, userId: string, data: ChatRequest): Promise<ChatResponse> {

  // Prefer a connection whose model is not known to lack tool calling;
  // when every one does, still answer (without tools) rather than fail.
  let resolved: Awaited<ReturnType<typeof resolveEndpoint>> | null = null;
  if (!data.endpoint_id) {
    try {
      resolved = await resolveEndpoint(userId, "chat", null, (r, m) => capsFor(r, m ?? r.model).tools !== false);
    } catch (e) {
      if (!(e instanceof Error) || !/No AI connection configured/.test(e.message)) throw e;
    }
  }
  resolved ??= await resolveEndpoint(userId, "chat", data.endpoint_id ?? null);
  const creds = resolved.creds;
  const caps = capsFor(resolved.endpoint, creds.model);

  // Settings for system prompt context.
  const { data: settings } = await supabase
    .from("settings")
    .select("currency_code, currency_symbol, language, active_scope_id")
    .maybeSingle();
  let activeScope: { id: string; name: string } | null = null;
  if (settings?.active_scope_id && (resolved.endpoint.context_level ?? "compact") !== "off") {
    const { data: scope } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", settings.active_scope_id)
      .eq("is_scope", true)
      .is("closed_at", null)
      .maybeSingle();
    activeScope = scope ? { id: scope.id, name: scope.name } : null;
  }

  // Context briefing: real accounts/categories/recent activity, sized per connection.
  let briefing = "";
  try {
    const { buildBriefingForUser } = await import("./aiContext.server");
    briefing = await buildBriefingForUser(
      supabase as never,
      resolved.endpoint.context_level ?? "compact",
      settings?.currency_code || "CHF",
    );
  } catch {
    briefing = "";
  }

  const sys = {
    currencyCode: settings?.currency_code || "CHF",
    currencySymbol: settings?.currency_symbol || "CHF",
    todayISO: new Date().toISOString().slice(0, 10),
    language: settings?.language || "de",
    briefing,
    activeScope,
  };

  // Earlier turns: from the database when persisted, from the client otherwise.
  let conversationId = data.conversation_id ?? null;
  let past: { role: "user" | "assistant"; text: string; attachment_ids: string[] }[] = [];
  if (data.persist) {
    if (!conversationId) {
      const title = (data.message || data.attachments?.[0]?.file_name || "Chat").slice(0, 60);
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
        const c = r.content && typeof r.content === "object" ? r.content : {};
        const ids = Array.isArray(c.attachments) ? c.attachments.map((a: any) => a?.id).filter(Boolean) : [];
        past.push({ role: r.role, text: c.text || "", attachment_ids: ids });
      }
    }
  } else {
    past = (data.history ?? []).map((h) => ({ role: h.role, text: h.text, attachment_ids: h.attachment_ids ?? [] }));
  }
  past = past.slice(-40);

  // New files: read and store first, so a scanned PDF fails before the model is asked.
  const current = [];
  for (const f of data.attachments ?? []) {
    current.push({ row: await storeAttachment(supabase, userId, f, data.persist ? conversationId : null), base64: f.file_base64 });
  }
  const earlier = await loadAttachments(supabase, past.flatMap((p) => p.attachment_ids));

  let imageBudget = caps.vision === false ? 0 : MAX_IMAGES_PER_REQUEST;
  const imageParts: { type: "image_url"; image_url: { url: string } }[] = [];
  const currentBlocks = current.map(({ row, base64 }) => {
    const show = row.text == null && imageBudget > 0;
    if (show) {
      imageBudget--;
      imageParts.push({ type: "image_url", image_url: { url: `data:${row.mime};base64,${base64}` } });
    }
    return formatAttachmentBlock(row, ATTACHMENT_CHARS_CURRENT, show);
  });

  // Images from earlier turns are re-sent (newest first) while the budget lasts.
  const earlierImages = new Map<string, string>();
  for (const p of [...past].reverse()) {
    for (const id of p.attachment_ids) {
      const a = earlier.find((e) => e.id === id);
      if (!a || a.text != null || imageBudget <= 0 || earlierImages.has(id)) continue;
      try {
        earlierImages.set(id, await attachmentBase64(supabase, a));
        imageBudget--;
      } catch {
        // The file is gone (pruned); the model gets the name only.
      }
    }
  }

  const history: ChatTurn[] = past.map((p) => {
    if (p.role !== "user" || p.attachment_ids.length === 0) return { role: p.role, content: p.text };
    const atts = p.attachment_ids.map((id) => earlier.find((e) => e.id === id)).filter(Boolean) as typeof earlier;
    const blocks = atts.map((a) => formatAttachmentBlock(a, ATTACHMENT_CHARS_HISTORY, earlierImages.has(a.id)));
    const text = userTurnText(p.text, blocks);
    const imgs = atts
      .filter((a) => earlierImages.has(a.id))
      .map((a) => ({ type: "image_url" as const, image_url: { url: `data:${a.mime};base64,${earlierImages.get(a.id)}` } }));
    return { role: "user", content: imgs.length ? [{ type: "text" as const, text }, ...imgs] : text };
  });
  const turnText = userTurnText(data.message, currentBlocks);
  history.push({
    role: "user",
    content: imageParts.length ? [{ type: "text", text: turnText }, ...imageParts] : turnText,
  });

  const refs = current.map(({ row }) => toRef(row));
  if (data.persist && conversationId) {
    await supabase.from("ai_messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: { text: data.message, ...(refs.length ? { attachments: refs } : {}) } as never,
    });
  }

  const result = await runChat(creds, supabase, userId, sys, history, {
    conversationId,
    endpointId: resolved.endpoint.id,
    caps,
    toolCtx: { attachments: [...earlier, ...current.map((c) => c.row)], conversationId },
  });

  if (data.persist && conversationId) {
    await supabase.from("ai_messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "assistant",
      content: { text: result.text, action: result.action, notices: result.notices } as never,
    });
    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  }

  return {
    conversation_id: conversationId,
    attachments: refs,
    message: {
      role: "assistant" as const,
      text: result.text,
      action: result.action,
      usage: result.usage ?? null,
      notices: result.notices,
    },
    endpoint: { id: resolved.endpoint.id, name: resolved.endpoint.name, fell_back: resolved.fell_back },
  };
}
