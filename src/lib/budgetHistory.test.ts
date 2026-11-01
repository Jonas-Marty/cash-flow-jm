import { describe, it, expect } from "vitest";
import { buildHistory, historyAverage, monthsBefore, prevMonthKey } from "./budgetHistory";

describe("month keys", () => {
  it("steps back across a year", () => {
    expect(prevMonthKey("2026-01-01")).toBe("2025-12-01");
    expect(monthsBefore("2026-10-01", 5)).toEqual([
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
  });
});

describe("buildHistory", () => {
  const months = ["2026-08-01", "2026-09-01"];
  const plans: Record<string, number> = {
    "food:2026-08-01": 850,
    "food:2026-09-01": 900,
    "salary:2026-08-01": 6800,
    "salary:2026-09-01": 6800,
  };
  const h = buildHistory({
    months,
    categories: [
      { id: "food", kind: "spend" },
      { id: "salary", kind: "income" },
      { id: "emergency", kind: "savings" },
    ],
    planOf: (id, m) => plans[`${id}:${m}`],
    txs: [
      { category_id: "food", type: "expense", amount: 900, occurred_on: "2026-08-10" },
      { category_id: "food", type: "income", amount: 13.2, occurred_on: "2026-08-15" },
      { category_id: "food", type: "expense", amount: 880, occurred_on: "2026-09-02" },
      { category_id: "food", type: "transfer", amount: 50, occurred_on: "2026-09-03" },
      { category_id: "salary", type: "income", amount: 6800, occurred_on: "2026-08-25" },
    ],
    savingsBalance: (id, ym) =>
      (({ "2026-07": 8000, "2026-08": 8300, "2026-09": 8100 }) as Record<string, number>)[ym],
  });

  it("nets refunds and uses each month's own plan", () => {
    expect(h.get("food")).toEqual([
      { month: "2026-08-01", value: 886.8, plan: 850 },
      { month: "2026-09-01", value: 880, plan: 900 },
    ]);
  });

  it("counts income received against the month's target", () => {
    expect(h.get("salary")!.map((p) => p.value)).toEqual([6800, 0]);
  });

  it("gives savings the change of the month-end balance", () => {
    expect(h.get("emergency")).toEqual([
      { month: "2026-08-01", value: 300, plan: null },
      { month: "2026-09-01", value: -200, plan: null },
    ]);
  });

  it("averages", () => {
    expect(historyAverage(h.get("emergency")!)).toBe(50);
  });
});
