// Server-only: proposes category / description / tags for pending rows that
// arrived without a category. The user's own history goes first; whatever it
// cannot place goes to the AI connection bound to `pending_enrich`.
//
// Best effort throughout. A row nobody could place keeps `suggested_at` NULL,
// so the next trigger — the next POST from the phone, the next visit to
// /pending, an AI connection being switched on — picks it up again. Nothing
// here ever writes category_id or description; that stays the user's tap.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger";
import { buildContextBriefing, type BriefingTx } from "@/lib/ai/contextBriefing";
import {
  MIN_HISTORY_CONFIDENCE,
  parseModelSuggestions,
  suggestFromHistory,
  type HistoryTx,
} from "@/lib/pendingSuggest";
import { resolveEndpoint } from "./ai.server";
import { callJsonModel } from "./statements.server";

export interface EnrichSummary {
  /** Rows looked at in this run. */
  rows: number;
  /** Rows history could place. */
  history: number;
  /** Rows the model placed. */
  ai: number;
  /** What happened to the rows history could not place. */
  ai_status: "ok" | "not_needed" | "unavailable" | "error";
  error?: string;
}

interface PendingRow {
  id: string;
  description: string | null;
  external_info: string | null;
  location_label: string | null;
  type: string;
  amount: number;
  occurred_on: string;
  source_account_id: string;
}

interface CategoryRow {
  id: string;
  name: string;
  group_id: string | null;
  is_savings: boolean;
  archived: boolean;
}

interface AccountRow {
  id: string;
  name: string;
  currency_code: string;
  archived: boolean;
}

interface GroupRow {
  id: string;
  name: string;
  kind: string | null;
}

const ROW_LIMIT = 60;
const HISTORY_LIMIT = 1500;
const HISTORY_DAYS = 365;
const BRIEFING_DAYS: Record<string, number> = { compact: 30, full: 30, xl: 180 };
const BRIEFING_TX_LIMIT: Record<string, number> = { compact: 400, full: 400, xl: 1200 };
const NOTIFICATION_CHARS = 400;

const SYSTEM = `You propose the category, description and tags for payments captured from phone notifications, for a personal finance app.
Every row carries the raw notification text; the merchant is usually in there even when the description is generic.
Use the user's own past entries in the snapshot: reuse their exact wording, their existing category ids and their tags whenever a similar past entry exists.
Rules:
- Never invent a category id. Only ids listed under Categories.
- description: the merchant or purpose in a few words, same language and style as past entries, no amounts or dates.
- tags: lowercase, no "#", max 3, prefer tags the user already uses.
- confidence: 0..1, how sure you are of the category.
- If you are unsure about a field, return null (for tags: an empty array). Do not guess wildly.
Return strict JSON: {"suggestions":[{"pending_id":"...","description":null|"...","category_id":null|"uuid","tags":["..."],"confidence":0.0}]}`;

/** One run per user at a time; a second trigger joins the run in flight. */
const running = new Map<string, Promise<EnrichSummary>>();

/**
 * Fills suggestions for the user's uncategorised pending rows.
 *
 * `force` re-examines rows that were already looked at (the "Suggest" button);
 * the default only touches rows with `suggested_at` NULL, which is what every
 * automatic trigger wants.
 */
export function enrichPending(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<EnrichSummary> {
  const inFlight = running.get(userId);
  if (inFlight) return inFlight;
  const run = enrich(userId, !!opts.force).finally(() => running.delete(userId));
  running.set(userId, run);
  return run;
}

async function enrich(userId: string, force: boolean): Promise<EnrichSummary> {
  const summary: EnrichSummary = { rows: 0, history: 0, ai: 0, ai_status: "not_needed" };

  let q = supabaseAdmin
    .from("pending_transactions")
    .select(
      "id, description, external_info, location_label, type, amount, occurred_on, source_account_id",
    )
    .eq("user_id", userId)
    .eq("status", "pending")
    .is("category_id", null)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (!force) q = q.is("suggested_at", null);
  const { data: rowsData, error: rowsErr } = await q;
  if (rowsErr) throw new Error(rowsErr.message);
  const rows: PendingRow[] = ((rowsData || []) as PendingRow[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));
  summary.rows = rows.length;
  if (rows.length === 0) return summary;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - HISTORY_DAYS);
  const [{ data: txData }, { data: catData }, { data: accData }] = await Promise.all([
    supabaseAdmin
      .from("transactions")
      .select("id, occurred_on, description, amount, type, source_account_id, category_id")
      .eq("user_id", userId)
      .gte("occurred_on", since.toISOString().slice(0, 10))
      .order("occurred_on", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabaseAdmin
      .from("categories")
      .select("id, name, group_id, is_savings, archived")
      .eq("user_id", userId),
    supabaseAdmin
      .from("accounts")
      .select("id, name, currency_code, archived")
      .eq("user_id", userId),
  ]);
  const history = (txData || []) as (HistoryTx & {
    id: string;
    amount: number;
    source_account_id: string;
  })[];
  const categories = ((catData || []) as CategoryRow[]).filter((c) => !c.archived);
  const validCategoryIds = new Set<string>(categories.map((c) => c.id));
  const now = new Date().toISOString();

  // ---- 1. history ---------------------------------------------------------
  const unresolved: PendingRow[] = [];
  for (const row of rows) {
    const s = suggestFromHistory(row, history);
    if (
      !s ||
      s.confidence < MIN_HISTORY_CONFIDENCE ||
      (s.category_id && !validCategoryIds.has(s.category_id))
    ) {
      unresolved.push(row);
      continue;
    }
    await supabaseAdmin
      .from("pending_transactions")
      .update({
        suggested_description: s.description,
        suggested_category_id: s.category_id,
        suggested_tags: [],
        suggestion_source: "history",
        suggestion_confidence: s.confidence,
        suggested_at: now,
      })
      .eq("id", row.id)
      .eq("user_id", userId);
    summary.history += 1;
  }
  if (unresolved.length === 0) return summary;

  // ---- 2. the model -------------------------------------------------------
  let resolved: Awaited<ReturnType<typeof resolveEndpoint>>;
  try {
    resolved = await resolveEndpoint(userId, "pending_enrich", null);
  } catch (e) {
    // No connection configured, or none reachable. Rows stay unmarked so
    // the next trigger tries again — this is the "local model is off right
    // now" case, and it must not cost the user a suggestion for good.
    summary.ai_status = "unavailable";
    summary.error = e instanceof Error ? e.message : String(e);
    log.info({
      event: "pending.enrich.ai_unavailable",
      userId,
      rows: unresolved.length,
      err: summary.error,
    });
    return summary;
  }

  try {
    const { creds, endpoint } = resolved;
    // "off" is a chat preference — without the category list the model has
    // nothing to pick from, so the pass always sends at least the compact one.
    const level = endpoint.context_level === "off" ? "compact" : endpoint.context_level;
    const windowDays = BRIEFING_DAYS[level] ?? 30;
    const briefingSince = new Date();
    briefingSince.setUTCDate(briefingSince.getUTCDate() - windowDays);
    const sinceISO = briefingSince.toISOString().slice(0, 10);
    const windowed = history
      .filter((t) => t.occurred_on >= sinceISO)
      .slice(0, BRIEFING_TX_LIMIT[level] ?? 400);

    const tagsByTx = new Map<string, string[]>();
    if (windowed.length) {
      const { data: tagRows } = await supabaseAdmin
        .from("transaction_tags")
        .select("transaction_id, tag")
        .in(
          "transaction_id",
          windowed.map((t) => t.id),
        );
      for (const r of (tagRows || []) as { transaction_id: string; tag: string }[]) {
        const list = tagsByTx.get(r.transaction_id) ?? [];
        list.push(r.tag);
        tagsByTx.set(r.transaction_id, list);
      }
    }

    const groupIds = [
      ...new Set(categories.map((c) => c.group_id).filter((g): g is string => !!g)),
    ];
    const { data: groupData } = groupIds.length
      ? await supabaseAdmin.from("category_groups").select("id, name, kind").in("id", groupIds)
      : { data: [] as GroupRow[] };
    const groupById = new Map(((groupData || []) as GroupRow[]).map((g) => [g.id, g]));

    const accounts = (accData || []) as AccountRow[];
    const currencyCode = accounts.find((a) => !a.archived)?.currency_code ?? "CHF";
    const accName = new Map(accounts.map((a) => [a.id, a.name]));

    const briefing = buildContextBriefing({
      level,
      currencyCode,
      windowDays,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency_code: a.currency_code,
        archived: !!a.archived,
      })),
      categories: categories.map((c) => {
        const g = c.group_id ? groupById.get(c.group_id) : undefined;
        return {
          id: c.id,
          name: c.name,
          group: g?.name ?? null,
          kind: g?.kind ?? null,
          is_savings: !!c.is_savings,
          budget: null,
          actual: null,
        };
      }),
      transactions: windowed.map(
        (t): BriefingTx => ({
          occurred_on: t.occurred_on,
          description: t.description,
          amount: Number(t.amount),
          type: t.type,
          account_id: t.source_account_id,
          category_id: t.category_id,
          tags: tagsByTx.get(t.id) ?? [],
        }),
      ),
    });

    const lines = unresolved
      .map((r) =>
        [
          r.id,
          r.occurred_on,
          `${r.amount.toFixed(2)} ${currencyCode}`,
          r.type,
          accName.get(r.source_account_id) ?? "-",
          r.description ?? "-",
          r.location_label ?? "-",
          oneLine(r.external_info),
        ].join(" | "),
      )
      .join("\n");
    const user = `${briefing}\n\n### Pending rows to classify (pending_id | date | amount | type | account | description | place | notification text)\n${lines}`;

    const json = await callJsonModel(creds, SYSTEM, user, {
      userId,
      fileName: null,
      source: "rows",
      part: `${unresolved.length} rows`,
      kind: "pending_enrich",
    });
    const suggestions = parseModelSuggestions(
      json,
      new Set(unresolved.map((r) => r.id)),
      validCategoryIds,
    );

    for (const row of unresolved) {
      const s = suggestions.get(row.id);
      await supabaseAdmin
        .from("pending_transactions")
        .update(
          s
            ? {
                suggested_description: s.description,
                suggested_category_id: s.category_id,
                suggested_tags: s.tags,
                suggestion_source: "ai",
                suggestion_confidence: s.confidence,
                suggested_at: now,
              }
            : // Looked, found nothing: marked so the automatic triggers stop
              // re-asking; "Suggest" still forces another look.
              {
                suggested_description: null,
                suggested_category_id: null,
                suggested_tags: [],
                suggestion_source: null,
                suggestion_confidence: null,
                suggested_at: now,
              },
        )
        .eq("id", row.id)
        .eq("user_id", userId);
      if (s) summary.ai += 1;
    }
    summary.ai_status = "ok";
  } catch (e) {
    summary.ai_status = "error";
    summary.error = e instanceof Error ? e.message : String(e);
    log.warn({
      event: "pending.enrich.ai_error",
      userId,
      rows: unresolved.length,
      err: summary.error,
    });
  }
  return summary;
}

/** Notification text on one line, so a row stays a row in the prompt. */
function oneLine(text: string | null): string {
  if (!text) return "-";
  return text
    .replace(/\s*\n+\s*/g, " ⏎ ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTIFICATION_CHARS);
}
