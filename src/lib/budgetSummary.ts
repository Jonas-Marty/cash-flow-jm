import type { CategoryMonthRow, PendingCategorySigned } from "@/lib/finance";
import { pendingDeltaForRow } from "@/lib/finance";

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
