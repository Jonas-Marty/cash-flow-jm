import type { Transaction } from "./finance";

const HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function decay(occurredOn: string, now: number): number {
  const age = (now - new Date(occurredOn).getTime()) / MS_PER_DAY;
  if (age < 0) return 1;
  return Math.exp(-age / HALF_LIFE_DAYS);
}

export function scoreAccounts(transactions: Transaction[], now = Date.now()): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transactions) {
    const w = decay(t.occurred_on, now);
    if (t.source_account_id) m.set(t.source_account_id, (m.get(t.source_account_id) ?? 0) + w);
    if (t.destination_account_id) m.set(t.destination_account_id, (m.get(t.destination_account_id) ?? 0) + w);
  }
  return m;
}

export function scoreCategories(transactions: Transaction[], now = Date.now()): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of transactions) {
    if (!t.category_id) continue;
    const w = decay(t.occurred_on, now);
    m.set(t.category_id, (m.get(t.category_id) ?? 0) + w);
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
