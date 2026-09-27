// Server-only: AI-proposed recurring rules (Settings ✨ button and chat tools).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Draft } from "@/lib/recurringDraft";
import {
  buildRuleExtractSystemPrompt,
  suggestionToDraft,
  type GuideContext,
  type GuideRule,
  type NamedRow,
  type SuggestionResult,
} from "@/lib/recurringAi";
import { resolveEndpoint } from "./ai.server";
import { callJsonModel } from "./statements.server";
import { readDocument } from "./documents.server";

/** Everything the guide needs, read with the user's own client (RLS). */
export async function loadGuideContext(sb: SupabaseClient): Promise<GuideContext> {
  const [rules, accounts, categories, settings] = await Promise.all([
    sb
      .from("recurring_rules")
      .select(
        "id, name, type, amount, is_variable_amount, estimated_amount, source_account_id, destination_account_id, category_id, description, recurrence_interval, execution_day_rule, execution_day_of_month, period_offset, starts_on, ends_on, archived",
      )
      .order("name"),
    sb.from("accounts").select("id, name, archived").order("name"),
    sb.from("categories").select("id, name, archived").order("name"),
    sb.from("settings").select("currency_code, language").maybeSingle(),
  ]);
  if (rules.error) throw new Error(rules.error.message);
  return {
    rules: ((rules.data || []) as any[]).map((r) => ({
      ...r,
      amount: r.amount == null ? null : Number(r.amount),
      estimated_amount: r.estimated_amount == null ? null : Number(r.estimated_amount),
    })) as GuideRule[],
    accounts: (accounts.data || []) as NamedRow[],
    categories: (categories.data || []) as NamedRow[],
    today: new Date().toISOString().slice(0, 10),
    currency: settings.data?.currency_code || "CHF",
    language: settings.data?.language || "de",
  };
}

export function toSuggestionResult(raw: unknown, ctx: GuideContext): SuggestionResult {
  return suggestionToDraft(raw, {
    accounts: ctx.accounts,
    categories: ctx.categories,
    rules: ctx.rules.filter((r) => !r.archived),
    today: ctx.today,
  });
}

export interface RuleDocumentResult {
  document_kind: "invoice" | "statement" | "other";
  draft: Draft | null;
  warnings: string[];
  notes: string[];
  similar_rule: { id: string; name: string } | null;
  endpoint: { id: string; name: string; fell_back: boolean };
}

/**
 * One model call: classify the document and, for an invoice, propose a rule.
 * Nothing is saved; the draft opens in the rule dialog.
 */
export async function analyseDocumentForRule(
  sb: SupabaseClient,
  userId: string,
  input: {
    file_name: string;
    file_type?: string | null;
    bytes: Uint8Array;
    base64: string;
    hint?: string | null;
    endpoint_id?: string | null;
  },
): Promise<RuleDocumentResult> {
  const doc = await readDocument(input.file_name, input.file_type, input.bytes);
  const ctx = await loadGuideContext(sb);
  const resolved = await resolveEndpoint(userId, "recurring_extract", input.endpoint_id ?? null);
  const system = buildRuleExtractSystemPrompt(ctx);
  const hint = input.hint?.trim() ? `\nUser hint: ${input.hint.trim().slice(0, 500)}` : "";
  const user =
    doc.kind === "text"
      ? `Document "${input.file_name}":${hint}\n\n${doc.text.slice(0, 40_000)}`
      : [
          { type: "text", text: `Document "${input.file_name}" (image).${hint}` },
          { type: "image_url", image_url: { url: `data:${doc.mime};base64,${input.base64}` } },
        ];
  const parsed = await callJsonModel(resolved.creds, system, user, {
    userId,
    fileName: input.file_name,
    source: doc.kind === "image" ? "image" : "pdf",
    part: "recurring_rule",
  });
  const kindRaw = String(parsed?.document_kind ?? "").toLowerCase();
  const document_kind: RuleDocumentResult["document_kind"] =
    kindRaw === "statement" ? "statement" : kindRaw === "invoice" || parsed?.rule ? "invoice" : "other";
  const endpoint = { id: resolved.endpoint.id, name: resolved.endpoint.name, fell_back: resolved.fell_back };
  if (document_kind !== "invoice" || !parsed?.rule) {
    const notes = Array.isArray(parsed?.rule?.notes ?? parsed?.notes) ? (parsed?.rule?.notes ?? parsed?.notes) : [];
    return { document_kind, draft: null, warnings: [], notes: notes.filter((n: unknown) => typeof n === "string"), similar_rule: null, endpoint };
  }
  const res = toSuggestionResult(parsed.rule, ctx);
  return { document_kind, ...res, endpoint };
}
