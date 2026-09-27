// Server-only: chat attachments (upload, lookup, bytes) in the ai-attachments bucket.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAttachmentRef } from "@/lib/ai/types";
import type { AttachmentForPrompt } from "@/lib/ai/attachmentTurn";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { base64ToBytes } from "./statements.server";
import { readDocument } from "./documents.server";

export const AI_ATTACHMENT_BUCKET = "ai-attachments";
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Unlinked attachments (sidebar chat, deleted conversation) are kept this long. */
export const ATTACHMENT_RETENTION_DAYS = 7;

export interface AttachmentRow extends AttachmentForPrompt {
  storage_path: string;
  conversation_id: string | null;
}

const COLS = "id, file_name, mime, page_count, extracted_text, storage_path, conversation_id";

function toRow(r: any): AttachmentRow {
  return {
    id: r.id,
    file_name: r.file_name,
    mime: r.mime,
    page_count: r.page_count ?? null,
    text: r.extracted_text ?? null,
    storage_path: r.storage_path,
    conversation_id: r.conversation_id ?? null,
  };
}

export function toRef(a: AttachmentRow): ChatAttachmentRef {
  return { id: a.id, file_name: a.file_name, mime: a.mime };
}

function ext(fileName: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "bin";
}

/**
 * Store one uploaded file and its extracted text. Reading happens first, so a
 * scanned PDF or an unsupported type fails before anything is written.
 */
export async function storeAttachment(
  sb: SupabaseClient,
  userId: string,
  file: { file_name: string; file_type?: string | null; file_base64: string },
  conversationId: string | null,
): Promise<AttachmentRow> {
  const bytes = base64ToBytes(file.file_base64);
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`"${file.file_name}" is larger than 15 MB.`);
  const doc = await readDocument(file.file_name, file.file_type, bytes);
  const mime = doc.mime;
  const path = `${userId}/${crypto.randomUUID()}.${ext(file.file_name)}`;
  const up = await sb.storage.from(AI_ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await sb
    .from("ai_attachments")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      file_name: file.file_name.slice(0, 200),
      mime,
      size_bytes: bytes.length,
      storage_path: path,
      extracted_text: doc.kind === "text" ? doc.text : null,
      page_count: doc.kind === "text" ? doc.pages : null,
    })
    .select(COLS)
    .single();
  if (error) {
    await sb.storage.from(AI_ATTACHMENT_BUCKET).remove([path]);
    throw new Error(error.message);
  }
  return toRow(data);
}

/** Attachments by id, in the order given. RLS drops ids of other users. */
export async function loadAttachments(sb: SupabaseClient, ids: string[]): Promise<AttachmentRow[]> {
  const unique = [...new Set(ids)].slice(0, 30);
  if (unique.length === 0) return [];
  const { data, error } = await sb.from("ai_attachments").select(COLS).in("id", unique);
  if (error) throw new Error(error.message);
  const rows = (data || []).map(toRow);
  return unique.map((id) => rows.find((r) => r.id === id)).filter(Boolean) as AttachmentRow[];
}

export async function attachmentBytes(sb: SupabaseClient, a: AttachmentRow): Promise<Uint8Array> {
  const { data, error } = await sb.storage.from(AI_ATTACHMENT_BUCKET).download(a.storage_path);
  if (error || !data) throw new Error(error?.message ?? "Attachment file is missing.");
  return new Uint8Array(await data.arrayBuffer());
}

export async function attachmentBase64(sb: SupabaseClient, a: AttachmentRow): Promise<string> {
  return Buffer.from(await attachmentBytes(sb, a)).toString("base64");
}

/** Remove the files and rows of one conversation (called before it is deleted). */
export async function deleteConversationAttachments(sb: SupabaseClient, conversationId: string): Promise<void> {
  const { data } = await sb.from("ai_attachments").select("id, storage_path").eq("conversation_id", conversationId);
  const rows = (data || []) as { id: string; storage_path: string }[];
  if (rows.length === 0) return;
  await sb.storage.from(AI_ATTACHMENT_BUCKET).remove(rows.map((r) => r.storage_path));
  await sb.from("ai_attachments").delete().in("id", rows.map((r) => r.id));
}

/**
 * Retention: attachments not linked to a conversation, older than
 * ATTACHMENT_RETENTION_DAYS. Runs with the service role from the prune job.
 */
export async function pruneUnlinkedAttachments(days = ATTACHMENT_RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  let deleted = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from("ai_attachments")
      .select("id, storage_path")
      .is("conversation_id", null)
      .lt("created_at", cutoff)
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { id: string; storage_path: string }[];
    if (rows.length === 0) return deleted;
    await supabaseAdmin.storage.from(AI_ATTACHMENT_BUCKET).remove(rows.map((r) => r.storage_path));
    const del = await supabaseAdmin.from("ai_attachments").delete().in("id", rows.map((r) => r.id));
    if (del.error) throw new Error(del.error.message);
    deleted += rows.length;
    if (rows.length < 500) return deleted;
  }
}
