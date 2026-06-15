import type { Transaction, TxType } from "./finance";
import { extractTags } from "./finance";

const HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function decay(occurredOn: string, now: number): number {
  const age = (now - new Date(occurredOn).getTime()) / MS_PER_DAY;
  if (age < 0) return 1;
  return Math.exp(-age / HALF_LIFE_DAYS);
}

/**
 * Context describing what the user has already filled in on the form.
 * Scorers use it to boost entities historically used with that combination
 * (e.g. categories used with the selected account, tags used with the
 * selected category). Missing fields are simply not applied.
 */
export interface SuggestionContext {
  type?: TxType;
  sourceAccountId?: string;
  destAccountId?: string;
  categoryId?: string;
  description?: string;
}

// Multipliers tuned so a matching context tripples the weight and a mismatching
// context still contributes (>0), so a chip with a brand-new combination
// never disappears — it just loses its head start to history.
const MATCH_BOOST = 3.0;
const MISMATCH_PENALTY = 0.25;
const DEST_MATCH_BOOST = 2.0;
const DEST_MISMATCH_PENALTY = 0.5;
const DESC_MATCH_BOOST = 1.5;

function descriptionMatches(query: string | undefined, candidate: string | null): boolean {
  if (!query) return false;
  const q = query.trim().toLowerCase();
  if (q.length < 2) return false;
  return !!candidate && candidate.toLowerCase().includes(q);
}

function contextWeight(t: Transaction, ctx: SuggestionContext, opts: { ignoreField?: "source" | "category" | "dest" } = {}): number {
  // Type acts as a hard filter — mixing income/expense history would noise
  // up category and tag suggestions in opposite directions.
  if (ctx.type && t.type !== ctx.type) return 0;
  let w = 1;
  if (ctx.sourceAccountId && opts.ignoreField !== "source") {
    w *= t.source_account_id === ctx.sourceAccountId ? MATCH_BOOST : MISMATCH_PENALTY;
  }
  if (ctx.categoryId && opts.ignoreField !== "category") {
    w *= t.category_id === ctx.categoryId ? MATCH_BOOST : MISMATCH_PENALTY;
  }
  if (ctx.destAccountId && opts.ignoreField !== "dest") {
    w *= t.destination_account_id === ctx.destAccountId ? DEST_MATCH_BOOST : DEST_MISMATCH_PENALTY;
  }
  if (ctx.description) {
    if (descriptionMatches(ctx.description, t.description)) w *= DESC_MATCH_BOOST;
  }
  return w;
}

export function scoreAccounts(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transactions) {
    // Don't penalise an account by its own absence: when ranking accounts,
    // ignore the selected source/dest in the context filter.
    const cw = contextWeight(t, ctx, { ignoreField: "source" });
    if (cw === 0) continue;
    const w = decay(t.occurred_on, now) * cw;
    if (t.source_account_id) m.set(t.source_account_id, (m.get(t.source_account_id) ?? 0) + w);
    if (t.destination_account_id) m.set(t.destination_account_id, (m.get(t.destination_account_id) ?? 0) + w);
  }
  return m;
}

export function scoreCategories(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transactions) {
    if (!t.category_id) continue;
    const cw = contextWeight(t, ctx, { ignoreField: "category" });
    if (cw === 0) continue;
    const w = decay(t.occurred_on, now) * cw;
    m.set(t.category_id, (m.get(t.category_id) ?? 0) + w);
  }
  return m;
}

export function scoreTags(
  transactions: Transaction[],
  ctx: SuggestionContext = {},
  now = Date.now(),
): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transactions) {
    const tags = extractTags(t.note);
    if (tags.length === 0) continue;
    const cw = contextWeight(t, ctx);
    if (cw === 0) continue;
    const w = decay(t.occurred_on, now) * cw;
    for (const tag of tags) {
      m.set(tag, (m.get(tag) ?? 0) + w);
    }
  }
  return m;
}

export interface SortableEntity {
  id: string;
  name: string;
  pinned?: boolean;
  pin_order?: number | null;
}

export function sortByPinAndScore<T extends SortableEntity>(items: T[], scores: Map<string, number>): T[] {
  return [...items].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      const ao = a.pin_order ?? 999_999;
      const bo = b.pin_order ?? 999_999;
      if (ao !== bo) return ao - bo;
    }
    const sa = scores.get(a.id) ?? 0;
    const sb = scores.get(b.id) ?? 0;
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });
}

// Deterministic color from a string (HSL via hash)
export function colorFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 60% 55%)`;
}

export function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
