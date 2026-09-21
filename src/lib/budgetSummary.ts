import type { Category, CategoryGroup, CategoryMonthRow, PendingCategorySigned } from "@/lib/finance";
import { pendingDeltaForRow } from "@/lib/finance";
import { effectiveKind } from "@/lib/budgetGrid";

export interface MonthBudgetTotals {
  incomeAllocated: number;
  incomeReceived: number;
  incomePending: number;
  incomeProjected: number;

  expenseAllocated: number;
  expenseSpent: number;
  expensePending: number;
  expenseProjected: number;

  savingsTarget: number;

  /** incomeProjected − expenseProjected − savingsTarget */
  projectedNet: number;
  /** incomeAllocated − expenseAllocated − savingsTarget (the plan itself) */
  plannedNet: number;
}

export function computeMonthTotals(
  rows: CategoryMonthRow[],
  pendingMap: Map<string, PendingCategorySigned>,
): MonthBudgetTotals {
  let incomeAllocated = 0, incomeReceived = 0, incomePending = 0;
  let expenseAllocated = 0, expenseSpent = 0, expensePending = 0;
  let savingsTarget = 0;

  for (const r of rows) {
    // A scope (a holiday, a camp) is funded in one move from its funding
    // envelope when it closes. Its plan and its spending are deliberately kept
    // out of the ordinary month, so counting either here double-counts it.
    if (r.is_scope) continue;
    const allocated = Number(r.allocated) || 0;
    const actual = Number(r.spent_or_received) || 0;
    const pending = pendingMap.get(r.category_id);
    const pendingDelta = pendingDeltaForRow(pending, r.kind);

    if (r.kind === "income") {
      incomeAllocated += allocated;
      incomeReceived += actual;
      incomePending += pendingDelta;
    } else if (r.kind === "savings") {
      savingsTarget += allocated;
    } else {
      expenseAllocated += allocated;
      expenseSpent += actual;
      expensePending += Math.max(0, pendingDelta);
    }
  }

  const incomeProjected = incomeReceived + incomePending;
  const expenseProjected = expenseSpent + expensePending;
  return {
    incomeAllocated, incomeReceived, incomePending, incomeProjected,
    expenseAllocated, expenseSpent, expensePending, expenseProjected,
    savingsTarget,
    projectedNet: incomeProjected - expenseProjected - savingsTarget,
    plannedNet: incomeAllocated - expenseAllocated - savingsTarget,
  };
}

export type BalanceVerdict = "balanced" | "buffer" | "over" | "tight" | "ok";

/**
 * Verdict for the Settings plan-balance card.
 *  - "over": planned spend > planned income
 *  - "balanced": within 1 currency unit of zero
 *  - "buffer": planned income leaves > 5% unallocated
 *  - "ok": small positive buffer
 */
export function planBalanceVerdict(t: MonthBudgetTotals): BalanceVerdict {
  const u = t.plannedNet;
  if (u < -0.5) return "over";
  if (Math.abs(u) < 1) return "balanced";
  if (t.incomeAllocated > 0 && u / t.incomeAllocated > 0.05) return "buffer";
  return "ok";
}

/**
 * Verdict for the monthly Overview "will I stay in budget?" header.
 *  - "over": projectedNet < -5% of income
 *  - "tight": projectedNet < 0 but within 5% of income
 *  - "ok": projectedNet >= 0
 */
export function monthVerdict(t: MonthBudgetTotals): BalanceVerdict {
  if (t.projectedNet >= 0) return "ok";
  if (t.incomeAllocated > 0 && t.projectedNet / t.incomeAllocated > -0.05) return "tight";
  return "over";
}

export interface PlanTotals {
  income: number;
  expense: number;
  savings: number;
  /** income − expense − savings. Positive means the plan leaves money unassigned. */
  unallocated: number;
}

/**
 * The plan for one month, summed per envelope flavour.
 *
 * `amounts` maps category id → that month's `category_budgets.amount`. Anything
 * missing from it falls back to `categories.allocated_budget`, which is the template
 * used to seed a month that has no row yet — so an envelope the user has never
 * budgeted still counts for what it is expected to cost.
 *
 * Scope envelopes are excluded: they are funded from their funding envelope when they
 * close and never take part in the monthly plan, the same rule `computeMonthTotals`
 * and `ensure_month_budgets` apply.
 */
export function computePlanTotals(
  categories: Category[],
  groups: CategoryGroup[],
  amounts?: Map<string, number>,
): PlanTotals {
  const groupKindById = new Map<string, CategoryGroup["kind"]>();
  for (const g of groups) groupKindById.set(g.id, g.kind);

  let income = 0, expense = 0, savings = 0;
  for (const c of categories) {
    if (c.archived) continue;
    if (c.is_scope) continue;
    // `??` not `||`: a deliberate zero budget for the month must stay zero.
    const v = amounts?.get(c.id) ?? (Number(c.allocated_budget) || 0);

    const kind = effectiveKind(c, groupKindById);
    if (kind === "income") income += v;
    else if (kind === "savings") savings += v;
    else expense += v;
  }
  return { income, expense, savings, unallocated: income - expense - savings };
}
