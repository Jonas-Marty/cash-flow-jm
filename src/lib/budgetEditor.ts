import type { CategoryBudgetCell } from "@/lib/finance";

/**
 * The arithmetic behind the month budget editor: reading what was typed, the
 * plan's balance, and which later months "from this month on" would overwrite.
 */

const EPS = 0.005;

/** A typed amount: "1'234.50", "1234,5" or "250" — null when it is not a number. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/['’\s]/g, "")
    .replace(",", ".");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export interface EditorField {
  id: string;
  kind: "income" | "spend" | "savings";
  /** The month's plan as stored. */
  amount: number;
}

export interface PlanBalance {
  income: number;
  spend: number;
  savings: number;
  /** income − spend − savings: positive is unplanned income, negative overplanned. */
  free: number;
}

/** The plan with the edits applied; a field with an invalid entry keeps its saved amount. */
export function planBalance(
  fields: EditorField[],
  edited: (f: EditorField) => number | null,
): PlanBalance {
  const b = { income: 0, spend: 0, savings: 0 };
  for (const f of fields) {
    const v = edited(f) ?? f.amount;
    b[f.kind] += v;
  }
  return { ...b, free: b.income - b.spend - b.savings };
}

/**
 * Later months already stored with a different amount than `value`.
 *
 * "From this month on" writes the new amount over every later stored month; months
 * with no row inherit it anyway, and months that already hold `value` do not change,
 * so neither is worth mentioning.
 */
export function overwrittenMonths(
  later: CategoryBudgetCell[],
  categoryId: string,
  month: string,
  value: number,
): CategoryBudgetCell[] {
  return later
    .filter(
      (c) => c.category_id === categoryId && c.month > month && Math.abs(c.amount - value) >= EPS,
    )
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function isChange(saved: number, value: number | null): boolean {
  return value === null || Math.abs(saved - value) >= EPS;
}
