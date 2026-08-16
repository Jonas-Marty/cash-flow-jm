// Client-safe formatter that turns raw finance rows into a compact
// "context briefing" text block for the assistant's system prompt.

export type AIContextLevel = "off" | "compact" | "full";

export interface BriefingAccount {
  id: string;
  name: string;
  currency_code: string;
  archived?: boolean;
}

export interface BriefingCategory {
  id: string;
  name: string;
  group?: string | null;
  kind?: string | null;
  is_savings?: boolean;
  budget?: number | null;
  actual?: number | null;
}

export interface BriefingTx {
  occurred_on: string;
  description: string | null;
  amount: number;
  type: string;
  account_id: string;
  category_id: string | null;
  tags: string[];
}

export interface BriefingInput {
  level: AIContextLevel;
  currencyCode: string;
  windowDays: number;
  accounts: BriefingAccount[];
  categories: BriefingCategory[];
  transactions: BriefingTx[];
}

const CAPS = {
  compact: { tags: 25, descriptions: 15, recent: 10, perAccountCats: 3 },
  full: { tags: 40, descriptions: 25, recent: 15, perAccountCats: 5 },
};

function round(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function topN<T>(counts: Map<T, number>, n: number): T[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function bump<T>(m: Map<T, number>, k: T, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function normDesc(d: string | null): string {
  return (d || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

/**
 * Renders the briefing. Returns "" when level is "off" or there is no data.
 * Target size: well under ~2000 tokens.
 */
export function buildContextBriefing(input: BriefingInput): string {
  if (input.level === "off") return "";
  const caps = CAPS[input.level] ?? CAPS.compact;
  const { accounts, categories, transactions, currencyCode } = input;
  if (accounts.length === 0 && categories.length === 0) return "";

  const accById = new Map(accounts.map((a) => [a.id, a]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const out: string[] = [];

  out.push(`## Your data (snapshot, generated now)`);
  out.push(
    `This is a live snapshot for grounding defaults. Amounts are in ${currencyCode} unless the account says otherwise.`,
  );

  // --- Accounts ---
  out.push(`\n### Accounts (id | name | currency)`);
  for (const a of accounts) {
    if (a.archived) continue;
    out.push(`${a.id} | ${a.name} | ${a.currency_code}`);
  }

  // --- Categories ---
  out.push(`\n### Categories (id | name | group | kind | budget | this month)`);
  for (const c of categories) {
    const kind = c.is_savings ? "savings" : (c.kind || "expense");
    const budget = c.budget != null ? round(c.budget) : "-";
    const actual = c.actual != null ? round(c.actual) : "-";
    out.push(`${c.id} | ${c.name} | ${c.group || "-"} | ${kind} | ${budget} | ${actual}`);
  }

  if (transactions.length === 0) {
    out.push(`\n(No transactions in the last ${input.windowDays} days.)`);
    return out.join("\n");
  }

  // --- Aggregations ---
  const tagCounts = new Map<string, number>();
  const perAccount = new Map<string, { count: number; cats: Map<string, number>; amounts: number[] }>();
  const perCategory = new Map<string, { count: number; amounts: number[]; tags: Map<string, number> }>();
  const perDesc = new Map<
    string,
    { count: number; amounts: number[]; cats: Map<string, number>; accs: Map<string, number>; tags: Map<string, number> }
  >();

  for (const t of transactions) {
    for (const tag of t.tags) bump(tagCounts, tag);

    const a = perAccount.get(t.account_id) ?? { count: 0, cats: new Map<string, number>(), amounts: [] as number[] };
    a.count += 1;
    a.amounts.push(Math.abs(t.amount));
    if (t.category_id) bump(a.cats, t.category_id);
    perAccount.set(t.account_id, a);

    if (t.category_id) {
      const c = perCategory.get(t.category_id) ?? { count: 0, amounts: [] as number[], tags: new Map<string, number>() };
      c.count += 1;
      c.amounts.push(Math.abs(t.amount));
      for (const tag of t.tags) bump(c.tags, tag);
      perCategory.set(t.category_id, c);
    }

    const key = normDesc(t.description).toLowerCase();
    if (key) {
      const d = perDesc.get(key) ?? { count: 0, amounts: [] as number[], cats: new Map<string, number>(), accs: new Map<string, number>(), tags: new Map<string, number>() };
      d.count += 1;
      d.amounts.push(Math.abs(t.amount));
      if (t.category_id) bump(d.cats, t.category_id);
      bump(d.accs, t.account_id);
      for (const tag of t.tags) bump(d.tags, tag);
      perDesc.set(key, d);
    }
  }

  const catName = (id: string) => catById.get(id)?.name ?? "?";
  const accName = (id: string) => accById.get(id)?.name ?? "?";

  // --- Tags ---
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, caps.tags);
  if (tags.length) {
    out.push(`\n### Tags used recently (tag×count)`);
    out.push(tags.map(([t, n]) => `#${t}×${n}`).join(", "));
  }

  // --- Per account habits ---
  out.push(`\n### Habits per account (last ${input.windowDays} days)`);
  for (const [accId, a] of [...perAccount.entries()].sort((x, y) => y[1].count - x[1].count)) {
    const cats = topN(a.cats, caps.perAccountCats).map((c) => catName(c));
    out.push(
      `${accName(accId)}: ${a.count} tx, usual categories: ${cats.join(", ") || "-"}, typical amount ~${round(
        median(a.amounts),
      )}`,
    );
  }

  // --- Per category habits ---
  if (perCategory.size) {
    out.push(`\n### Habits per category (count | median amount | usual tags)`);
    for (const [catId, c] of [...perCategory.entries()].sort((x, y) => y[1].count - x[1].count)) {
      const tg = topN(c.tags, 3).map((t) => `#${t}`);
      out.push(`${catName(catId)}: ${c.count} | ${round(median(c.amounts))} | ${tg.join(" ") || "-"}`);
    }
  }

  // --- Frequent descriptions ---
  const descs = [...perDesc.entries()].filter(([, d]) => d.count > 1).sort((a, b) => b[1].count - a[1].count).slice(0, caps.descriptions);
  if (descs.length) {
    out.push(`\n### Frequent descriptions (text | count | usual category | usual account | usual tags | median)`);
    for (const [key, d] of descs) {
      const cat = topN(d.cats, 1)[0];
      const acc = topN(d.accs, 1)[0];
      const tg = topN(d.tags, 2).map((t) => `#${t}`);
      out.push(
        `${key} | ${d.count} | ${cat ? catName(cat) : "-"} | ${acc ? accName(acc) : "-"} | ${tg.join(" ") || "-"} | ${round(
          median(d.amounts),
        )}`,
      );
    }
  }

  // --- Most recent raw rows ---
  const recent = [...transactions].sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1)).slice(0, caps.recent);
  out.push(`\n### Most recent transactions (date | description | amount | type | account | category | tags)`);
  for (const t of recent) {
    out.push(
      `${t.occurred_on} | ${normDesc(t.description) || "-"} | ${round(t.amount)} | ${t.type} | ${accName(
        t.account_id,
      )} | ${t.category_id ? catName(t.category_id) : "-"} | ${t.tags.map((x) => `#${x}`).join(" ") || "-"}`,
    );
  }

  return out.join("\n");
}
