import type { CategoryMonthRow, GroupKind, LedgerRow, PendingCategorySigned } from "@/lib/finance";
import { pendingDeltaForRow } from "@/lib/finance";

/**
 * The model behind the compact Budgets view: one line per budget, grouped as in
 * Settings, with the figures each line and group header shows.
 *
 * Three kinds of line:
 *  - spend: a budget money is spent from. Monthly ones get their plan for the
 *    month; rolling ones (in a spending group) also carry what earlier months
 *    left, or overspent, so their bar runs against plan + carry-over.
 *  - income: received against the month's target.
 *  - savings: a rolling budget in a savings group. No bar, because nothing is
 *    spent against a target; the balance and the month's change instead.
 */

const EPS = 0.005;

export type RowStatus = "over" | "ok" | "done" | "idle";

export interface SpendRow {
  type: "spend";
  id: string;
  name: string;
  rolling: boolean;
  /** The month's plan. */
  allocated: number;
  /** Booked this month, refunds netted. */
  spent: number;
  /** Not yet booked occurrences of recurring rules, never negative. */
  pending: number;
  /** What a rolling budget brought into the month on top of its plan (may be negative). */
  carry: number;
  /** allocated + carry */
  available: number;
  /** available − spent − pending; negative when overspent */
  remaining: number;
  status: RowStatus;
  /** Archived, shown only for the bookings it still has in the month. */
  archived?: boolean;
}

export interface IncomeRow {
  type: "income";
  id: string;
  name: string;
  target: number;
  received: number;
  pending: number;
  status: RowStatus;
  archived?: boolean;
}

export interface SavingsRow {
  type: "savings";
  id: string;
  name: string;
  /** The month's allocation. */
  allocated: number;
  balance: number;
  /** Net change of the balance this month. */
  monthChange: number;
}

export type OverviewRow = SpendRow | IncomeRow | SavingsRow;

export interface OverviewGroup {
  key: string;
  /** null for the synthetic buckets of budgets without a group. */
  name: string | null;
  kind: GroupKind;
  rows: OverviewRow[];
}

export function spendStatus(available: number, spent: number, pending: number): RowStatus {
  const projected = spent + pending;
  if (projected > available + EPS) return "over";
  if (Math.abs(spent) < EPS && Math.abs(pending) < EPS) return "idle";
  if (Math.abs(available - projected) < EPS) return "done";
  return "ok";
}

export function incomeStatus(target: number, received: number, pending: number): RowStatus {
  const projected = received + pending;
  if (projected < EPS) return "idle";
  if (projected >= target - EPS) return "done";
  return "ok";
}

/**
 * A rolling spending budget's month, from its ledger rows for the month.
 *
 * The balance before the first row is what the month started with. Everything
 * that is not a booking (the allocation, reallocations, leftovers swept in) is
 * money made available; bookings are what was spent. Without ledger rows the
 * month has not started moving, so the current balance is all there is.
 */
export function rollingMonth(
  ledger: LedgerRow[] | undefined,
  month: string,
  balanceFallback: number,
): { available: number; spent: number } {
  const prefix = month.slice(0, 7);
  const rows = (ledger ?? []).filter(
    (l) => l.kind !== "sweep_out" && l.kind !== "opening" && l.occurred_on?.startsWith(prefix),
  );
  if (rows.length === 0) return { available: balanceFallback, spent: 0 };
  const sum = rows.reduce((s, l) => s + l.amount, 0);
  const start = rows[rows.length - 1].running_balance - sum;
  let spent = 0;
  let inflow = 0;
  for (const l of rows) {
    if (l.kind === "transaction") spent -= l.amount;
    else inflow += l.amount;
  }
  return { available: start + inflow, spent };
}

export interface OverviewInput {
  rows: CategoryMonthRow[];
  /** Kind of each category group, by id. */
  groupKindById: Map<string, GroupKind>;
  pendingMap: Map<string, PendingCategorySigned>;
  /** The month's ledger rows per category (category_ledger_month). */
  ledgerByCategory?: Map<string, LedgerRow[]>;
  /** Cumulative balance per rolling category. */
  balanceById: Map<string, number>;
  /** The month as `YYYY-MM-01`. */
  month: string;
  /**
   * Archived budgets with bookings in the month. They have no plan any more, so
   * they show only what was booked and stay out of every total.
   */
  archivedRows?: CategoryMonthRow[];
}

export function buildOverview(input: OverviewInput): OverviewGroup[] {
  const { rows, groupKindById, pendingMap, ledgerByCategory, balanceById, month } = input;
  const groups = new Map<string, OverviewGroup>();
  const groupFor = (r: CategoryMonthRow) => {
    const groupKind: GroupKind = (r.group_id ? groupKindById.get(r.group_id) : undefined) ?? r.kind;
    const key = r.group_id ?? `__${groupKind}__`;
    let g = groups.get(key);
    if (!g) {
      g = { key, name: r.group_id ? (r.group_name ?? "") : null, kind: groupKind, rows: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const r of rows) {
    // Scopes are managed on /scopes and sit outside the month.
    if (r.is_scope) continue;
    const g = groupFor(r);
    const groupKind: GroupKind = (r.group_id ? groupKindById.get(r.group_id) : undefined) ?? r.kind;

    const allocated = Number(r.allocated) || 0;
    const pending = pendingMap.get(r.category_id);

    if (r.kind === "income") {
      const received = Number(r.spent_or_received) || 0;
      const p = Math.max(0, pendingDeltaForRow(pending, "income"));
      g.rows.push({
        type: "income",
        id: r.category_id,
        name: r.name,
        target: allocated,
        received,
        pending: p,
        status: incomeStatus(allocated, received, p),
      });
      continue;
    }

    if (r.rolls_over && groupKind === "savings") {
      const ledger = ledgerByCategory?.get(r.category_id);
      const prefix = month.slice(0, 7);
      const monthChange = ledger
        ? ledger.reduce(
            (s, l) =>
              l.kind !== "sweep_out" && l.occurred_on?.startsWith(prefix) ? s + l.amount : s,
            0,
          )
        : 0;
      g.rows.push({
        type: "savings",
        id: r.category_id,
        name: r.name,
        allocated,
        balance: balanceById.get(r.category_id) ?? 0,
        monthChange,
      });
      continue;
    }

    const pendingPos = Math.max(0, pendingDeltaForRow(pending, "expense"));
    let available = allocated;
    let spent = Number(r.spent_or_received) || 0;
    if (r.rolls_over) {
      const m = rollingMonth(
        ledgerByCategory?.get(r.category_id),
        month,
        balanceById.get(r.category_id) ?? 0,
      );
      available = m.available;
      spent = m.spent;
    }
    g.rows.push({
      type: "spend",
      id: r.category_id,
      name: r.name,
      rolling: r.rolls_over,
      allocated,
      spent,
      pending: pendingPos,
      carry: available - allocated,
      available,
      remaining: available - spent - pendingPos,
      status: spendStatus(available, spent, pendingPos),
    });
  }

  for (const r of input.archivedRows ?? []) {
    if (r.is_scope) continue;
    const g = groupFor(r);
    const booked = Number(r.spent_or_received) || 0;
    if (r.kind === "income") {
      g.rows.push({
        type: "income",
        id: r.category_id,
        name: r.name,
        target: 0,
        received: booked,
        pending: 0,
        status: "idle",
        archived: true,
      });
    } else {
      g.rows.push({
        type: "spend",
        id: r.category_id,
        name: r.name,
        rolling: false,
        allocated: 0,
        spent: booked,
        pending: 0,
        carry: 0,
        available: 0,
        remaining: -booked,
        status: "idle",
        archived: true,
      });
    }
  }

  // Income first, then the order of Settings.
  const list = Array.from(groups.values()).filter((g) => g.rows.length > 0);
  return [...list.filter((g) => g.kind === "income"), ...list.filter((g) => g.kind !== "income")];
}

export interface SpendTotals {
  available: number;
  spent: number;
  pending: number;
  remaining: number;
  overCount: number;
  /** Every budget used up exactly as planned, none over, at least one row. */
  allDone: boolean;
}

export function spendTotals(rows: OverviewRow[]): SpendTotals {
  const spend = rows.filter((r): r is SpendRow => r.type === "spend" && !r.archived);
  const t = {
    available: 0,
    spent: 0,
    pending: 0,
    remaining: 0,
    overCount: 0,
    allDone: spend.length > 0,
  };
  for (const r of spend) {
    t.available += r.available;
    t.spent += r.spent;
    t.pending += r.pending;
    t.remaining += r.remaining;
    if (r.status === "over") t.overCount += 1;
    if (r.status !== "done") t.allDone = false;
  }
  return t;
}

export function incomeTotals(rows: OverviewRow[]) {
  const income = rows.filter((r): r is IncomeRow => r.type === "income" && !r.archived);
  return {
    target: income.reduce((s, r) => s + r.target, 0),
    received: income.reduce((s, r) => s + r.received, 0),
    pending: income.reduce((s, r) => s + r.pending, 0),
    allDone: income.length > 0 && income.every((r) => r.status === "done"),
  };
}

export function savingsTotals(rows: OverviewRow[]) {
  const savings = rows.filter((r): r is SavingsRow => r.type === "savings");
  return {
    balance: savings.reduce((s, r) => s + r.balance, 0),
    monthChange: savings.reduce((s, r) => s + r.monthChange, 0),
  };
}

export interface OverviewSummary {
  /** Monthly (non-rolling) spending budgets only. */
  monthly: { allocated: number; spent: number; pending: number; remaining: number };
  /** Every spending budget that is over, rolling ones included. */
  overCount: number;
  income: { target: number; received: number };
}

/**
 * The figures above the list. Rolling budgets stay out of Ausgaben and Übrig:
 * money saved up over months for one bill would otherwise read as "left over"
 * every month until the bill arrives.
 */
export function overviewSummary(groups: OverviewGroup[]): OverviewSummary {
  const all = groups.flatMap((g) => g.rows).filter((r) => r.type === "savings" || !r.archived);
  const monthly = all.filter((r): r is SpendRow => r.type === "spend" && !r.rolling);
  const inc = incomeTotals(all);
  return {
    monthly: {
      allocated: monthly.reduce((s, r) => s + r.allocated, 0),
      spent: monthly.reduce((s, r) => s + r.spent, 0),
      pending: monthly.reduce((s, r) => s + r.pending, 0),
      remaining: monthly.reduce((s, r) => s + r.remaining, 0),
    },
    overCount: all.filter((r) => r.type === "spend" && r.status === "over").length,
    income: { target: inc.target, received: inc.received },
  };
}
