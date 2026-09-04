// Server-only: guesses description / category / tags for statement lines that
// have no matching transaction yet, so "Create" opens a prefilled Add form.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEndpoint } from "./ai.server";
import { callJsonModel } from "./statements.server";
import { buildBriefingForUser } from "./aiContext.server";

interface OpenLine {
  id: string;
  booking_date: string | null;
  value_date: string | null;
  description: string;
  amount: number;
}

const SYSTEM = `You classify bank-statement rows for a personal finance app.
For every row, propose the description, category and tags the user would have used, based on their own past entries in the snapshot.
Rules:
- Reuse the user's exact wording and existing category ids and tags whenever a similar past entry exists. Never invent a category id.
- description: short (a few words), same language and style as past entries, no amounts or dates.
- tags: lowercase, no "#", max 3, prefer existing tags (merchant/shop first).
- If you are unsure about a field, return null (for tags: an empty array). Do not guess wildly.
Return strict JSON: {"suggestions":[{"line_id":"...","description":null|"...","category_id":null|"uuid","tags":["..."]}]}`;

/**
 * Classifies still-open lines of an import. Best effort: any failure is
 * swallowed so import/re-analyze never breaks because AI is unavailable.
 */
export async function classifyOpenStatementLines(
  sb: SupabaseClient,
  userId: string,
  importId: string,
): Promise<{ classified: number }> {
  const { data, error } = await sb
    .from("statement_import_lines")
    .select("id, booking_date, value_date, description, amount, suggested_description")
    .eq("import_id", importId)
    .eq("match_status", "unmatched")
    .limit(120);
  if (error) throw new Error(error.message);
  const open = (data || [])
    .filter((r: any) => !r.suggested_description)
    .map((r: any) => ({
      id: r.id,
      booking_date: r.booking_date,
      value_date: r.value_date,
      description: r.description,
      amount: Number(r.amount),
    })) as OpenLine[];
  if (open.length === 0) return { classified: 0 };

  const [{ creds }, briefing] = await Promise.all([
    resolveEndpoint(userId, "statement_classify", null),
    buildBriefingForUser(sb, "full", "CHF"),
  ]);

  const rows = open
    .map(
      (l) =>
        `${l.id} | ${l.booking_date ?? l.value_date ?? "-"} | ${l.description} | ${l.amount.toFixed(2)}`,
    )
    .join("\n");
  const user = `${briefing}\n\n### Statement rows to classify (line_id | date | text | amount)\n${rows}`;

  const json = await callJsonModel(creds, SYSTEM, user, {
    userId,
    fileName: null,
    source: "rows",
    part: "classify",
    kind: "statement_classify",
  });

  const validCats = new Set(
    ((await sb.from("categories").select("id").eq("archived", false)).data || []).map((c: any) => c.id),
  );
  const suggestions = Array.isArray(json?.suggestions) ? json.suggestions : [];
  const byId = new Map(open.map((l) => [l.id, l]));
  let n = 0;
  for (const s of suggestions as any[]) {
    const line = byId.get(String(s?.line_id));
    if (!line) continue;
    const desc = typeof s?.description === "string" && s.description.trim() ? s.description.trim().slice(0, 120) : null;
    const catId = typeof s?.category_id === "string" && validCats.has(s.category_id) ? s.category_id : null;
    const tags = Array.isArray(s?.tags)
      ? (s.tags as unknown[])
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.replace(/^#/, "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (!desc && !catId && tags.length === 0) continue;
    await sb
      .from("statement_import_lines")
      .update({ suggested_description: desc, suggested_category_id: catId, suggested_tags: tags })
      .eq("id", line.id);
    n++;
  }
  return { classified: n };
}