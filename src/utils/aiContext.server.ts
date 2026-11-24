// Server-only: assembles the assistant's "context briefing" from real data.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  buildContextBriefing,
  type AIContextLevel,
  type BriefingAccount,
  type BriefingCategory,
  type BriefingTx,
} from "@/lib/ai/contextBriefing";

type Sb = SupabaseClient<Database>;

const WINDOW_DAYS: Record<string, number> = { compact: 30, full: 30, xl: 180 };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads accounts, categories (with this month's budget/actual) and the last
 * 30 days of transactions through the request-scoped client (RLS applies),
 * then renders a compact text block for the system prompt.
 */
export async function buildBriefingForUser(
  sb: Sb,
  level: AIContextLevel,
  currencyCode: string,
): Promise<string> {
  if (level === "off") return "";

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthISO = monthStart.toISOString().slice(0, 10);
  const windowDays = WINDOW_DAYS[level] ?? 30;
  const since = isoDaysAgo(windowDays);

  const [accRes, catRes, spendRes, txRes] = await Promise.all([
    sb.from("accounts").select("id, name, currency_code, archived").order("name"),
    sb
      .from("categories")
      .select("id, name, rolls_over, archived, group_id, allocated_budget")
      .order("sort_order"),
    sb.rpc("category_month_spending", { p_month: monthISO }),
    sb
      .from("transactions")
      .select("id, occurred_on, description, amount, type, source_account_id, category_id")
      .gte("occurred_on", since)
      .order("occurred_on", { ascending: false })
      .limit(level === "xl" ? 1200 : 400),
  ]);

  const accounts: BriefingAccount[] = (accRes.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    currency_code: a.currency_code,
    archived: !!a.archived,
  }));

  const spend = new Map((spendRes.data || []).map((r) => [r.category_id, r]));
  const categories: BriefingCategory[] = (catRes.data || [])
    .filter((c) => !c.archived)
    .map((c) => {
      const s = spend.get(c.id);
      return {
        id: c.id,
        name: c.name,
        group: s?.group_name ?? null,
        kind: s?.kind ?? null,
        rolls_over: !!c.rolls_over,
        budget: s?.allocated ?? c.allocated_budget ?? null,
        actual: s?.spent_or_received ?? null,
      } satisfies BriefingCategory;
    });

  const txRows = txRes.data || [];
  const tagsByTx = new Map<string, string[]>();
  if (txRows.length) {
    const { data: tagRows } = await sb
      .from("transaction_tags")
      .select("transaction_id, tag")
      .in(
        "transaction_id",
        txRows.map((t) => t.id),
      );
    for (const r of tagRows || []) {
      const list = tagsByTx.get(r.transaction_id) ?? [];
      list.push(r.tag);
      tagsByTx.set(r.transaction_id, list);
    }
  }

  const transactions: BriefingTx[] = txRows.map((t) => ({
    occurred_on: t.occurred_on,
    description: t.description,
    amount: Number(t.amount),
    type: t.type,
    account_id: t.source_account_id,
    category_id: t.category_id,
    tags: tagsByTx.get(t.id) ?? [],
  }));

  return buildContextBriefing({
    level,
    currencyCode,
    windowDays,
    accounts,
    categories,
    transactions,
  });
}
