import type { Category } from "@/lib/finance";

export const cents = (v: number) => Math.round(v * 100) / 100;

/** An amount as typed: 1'000.50, 1000,5, -200. Empty counts as 0; null when not a number. */
export function parseOpening(raw: string): number | null {
  const s = raw.replace(/['\s]/g, "").replace(",", ".");
  if (s === "" || s === "-") return 0;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** What the accounts held before the first booking, across all accounts. */
export function accountOpeningsTotal(accounts: { opening_balance: number | string | null }[]) {
  // Archived accounts count too: envelope_reconciliation counts them, and an
  // archived account's opening is still money that was there on day one.
  return cents(accounts.reduce((s, a) => s + Number(a.opening_balance ?? 0), 0));
}

/** Rolling budgets that are not scopes: the only ones that hold an opening balance. */
export function holdsOpening(c: Pick<Category, "rolls_over" | "is_scope">) {
  return c.rolls_over && !c.is_scope;
}
