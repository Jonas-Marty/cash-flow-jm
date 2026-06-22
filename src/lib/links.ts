import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type TransactionLink = Database["public"]["Tables"]["transaction_links"]["Row"];
export type TransactionLinkKind = Database["public"]["Enums"]["transaction_link_kind"];
export type TransactionLinkMember = Database["public"]["Tables"]["transaction_link_members"]["Row"];

export const LINK_KINDS: TransactionLinkKind[] = ["purchase", "event", "trip", "other"];

export async function fetchTransactionLinks(): Promise<TransactionLink[]> {
  const { data, error } = await supabase
    .from("transaction_links")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchTransactionLinkMembers(): Promise<TransactionLinkMember[]> {
  const { data, error } = await supabase.from("transaction_link_members").select("*");
  if (error) throw error;
  return data ?? [];
}

export async function createTransactionLink(input: {
  title: string;
  kind?: TransactionLinkKind;
  note?: string | null;
  planned_on?: string | null;
}): Promise<TransactionLink> {
  const { data: userData, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("transaction_links")
    .insert({
      user_id: userId,
      title: input.title.trim(),
      kind: input.kind ?? "purchase",
      note: input.note?.trim() || null,
      planned_on: input.planned_on || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateTransactionLink(
  id: string,
  patch: Partial<Pick<TransactionLink, "title" | "kind" | "note" | "planned_on">>,
): Promise<void> {
  const { error } = await supabase.from("transaction_links").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTransactionLink(id: string): Promise<void> {
  const { error } = await supabase.from("transaction_links").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Attach a transaction to a link. Because `transaction_id` is the PK, this
 * upsert atomically moves the transaction from any previous link to the new one.
 */
export async function attachTransactionToLink(transactionId: string, linkId: string): Promise<void> {
  const { error } = await supabase
    .from("transaction_link_members")
    .upsert({ transaction_id: transactionId, link_id: linkId }, { onConflict: "transaction_id" });
  if (error) throw error;
}

export async function detachTransactionFromLink(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from("transaction_link_members")
    .delete()
    .eq("transaction_id", transactionId);
  if (error) throw error;
}