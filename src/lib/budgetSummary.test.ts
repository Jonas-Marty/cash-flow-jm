import { describe, it, expect } from "vitest";
import {
  computeMonthTotals,
  planBalanceVerdict,
  monthVerdict,
  type MonthBudgetTotals,
} from "./budgetSummary";
import type { CategoryMonthRow, PendingCategorySigned } from "./finance";

function row(p: Partial<CategoryMonthRow> & { category_id: string; kind: CategoryMonthRow["kind"] }): CategoryMonthRow {
  return {
    category_id: p.category_id,
    name: p.name ?? p.category_id,
    kind: p.kind,
    allocated: p.allocated ?? 0,
    spent_or_received: p.spent_or_received ?? 0,
    variance: p.variance ?? (p.allocated ?? 0) - (p.spent_or_received ?? 0),
    group_id: p.group_id ?? null,
    group_name: p.group_name ?? null,
    is_savings: p.is_savings ?? (p.kind === "savings"),
    sort_order: p.sort_order ?? 0,
    group_sort_order: p.group_sort_order ?? 0,
  };
}

const noPending: Map<string, PendingCategorySigned> = new Map();

describe("computeMonthTotals", () => {
  it("returns all-zero totals for an empty row set", () => {
    const t = computeMonthTotals([], noPending);
    expect(t.incomeAllocated).toBe(0);
    expect(t.expenseAllocated).toBe(0);
    expect(t.savingsTarget).toBe(0);
    expect(t.projectedNet).toBe(0);
    expect(t.plannedNet).toBe(0);
  });

  it("aggregates income / expense / savings into the right buckets", () => {
    const rows = [
      row({ category_id: "salary", kind: "income", allocated: 5000, spent_or_received: 4000 }),
      row({ category_id: "rent", kind: "expense", allocated: 1500, spent_or_received: 1500 }),
      row({ category_id: "food", kind: "expense", allocated: 600, spent_or_received: 200 }),
      row({ category_id: "vacation", kind: "savings", allocated: 300, spent_or_received: 0 }),
    ];
    const t = computeMonthTotals(rows, noPending);
    expect(t.incomeAllocated).toBe(5000);
    expect(t.incomeReceived).toBe(4000);
    expect(t.expenseAllocated).toBe(2100);
    expect(t.expenseSpent).toBe(1700);
    expect(t.savingsTarget).toBe(300);
    expect(t.plannedNet).toBe(5000 - 2100 - 300); // 2600
    expect(t.projectedNet).toBe(4000 - 1700 - 300); // 2000
  });

  it("adds pending income to projected income and pending expense to projected expense", () => {
    const rows = [
      row({ category_id: "salary", kind: "income", allocated: 5000, spent_or_received: 0 }),
      row({ category_id: "rent", kind: "expense", allocated: 1500, spent_or_received: 0 }),
    ];
    const pending = new Map<string, PendingCategorySigned>([
      ["salary", { expense: 0, income: 5000 }],
      ["rent", { expense: 1500, income: 0 }],
    ]);
    const t = computeMonthTotals(rows, pending);
    expect(t.incomePending).toBe(5000);
    expect(t.expensePending).toBe(1500);
    expect(t.incomeProjected).toBe(5000);
    expect(t.expenseProjected).toBe(1500);
    expect(t.projectedNet).toBe(3500);
  });

  it("treats refunds (income on expense category) as a clamped non-negative pending", () => {
    const rows = [
      row({ category_id: "food", kind: "expense", allocated: 500, spent_or_received: 0 }),
    ];
    // pending refund of 200 on an expense category → delta is negative, clamped to 0
    const pending = new Map<string, PendingCategorySigned>([
      ["food", { expense: 0, income: 200 }],
    ]);
    const t = computeMonthTotals(rows, pending);
    expect(t.expensePending).toBe(0);
    expect(t.expenseProjected).toBe(0);
  });
});

const totals = (over: Partial<MonthBudgetTotals> = {}): MonthBudgetTotals => ({
  incomeAllocated: 0, incomeReceived: 0, incomePending: 0, incomeProjected: 0,
  expenseAllocated: 0, expenseSpent: 0, expensePending: 0, expenseProjected: 0,
  savingsTarget: 0, projectedNet: 0, plannedNet: 0,
  ...over,
});

describe("planBalanceVerdict", () => {
  it("returns 'over' when planned spend exceeds planned income beyond 0.5", () => {
    expect(planBalanceVerdict(totals({ plannedNet: -1 }))).toBe("over");
  });
  it("returns 'balanced' within 1 unit of zero", () => {
    expect(planBalanceVerdict(totals({ plannedNet: 0 }))).toBe("balanced");
    expect(planBalanceVerdict(totals({ plannedNet: 0.4 }))).toBe("balanced");
  });
  it("returns 'buffer' when more than 5% of income is unallocated", () => {
    expect(planBalanceVerdict(totals({ incomeAllocated: 1000, plannedNet: 100 }))).toBe("buffer");
  });
  it("returns 'ok' for small positive buffers", () => {
    expect(planBalanceVerdict(totals({ incomeAllocated: 1000, plannedNet: 40 }))).toBe("ok");
  });
});

describe("monthVerdict", () => {
  it("is 'ok' when projected net is non-negative", () => {
    expect(monthVerdict(totals({ projectedNet: 0 }))).toBe("ok");
    expect(monthVerdict(totals({ projectedNet: 5 }))).toBe("ok");
  });
  it("is 'tight' when projected net is slightly negative (>-5% of income)", () => {
    expect(monthVerdict(totals({ incomeAllocated: 1000, projectedNet: -30 }))).toBe("tight");
  });
  it("is 'over' when projected net is more than 5% under income", () => {
    expect(monthVerdict(totals({ incomeAllocated: 1000, projectedNet: -100 }))).toBe("over");
  });
  it("is 'over' for negative projection with no income reference", () => {
    expect(monthVerdict(totals({ incomeAllocated: 0, projectedNet: -10 }))).toBe("over");
  });
});