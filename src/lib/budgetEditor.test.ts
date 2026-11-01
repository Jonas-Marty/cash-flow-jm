import { describe, it, expect } from "vitest";
import {
  isChange,
  overwrittenMonths,
  parseAmount,
  planBalance,
  type EditorField,
} from "./budgetEditor";

describe("parseAmount", () => {
  it("reads Swiss and plain formats", () => {
    expect(parseAmount("1'234.50")).toBe(1234.5);
    expect(parseAmount("1234,5")).toBe(1234.5);
    expect(parseAmount(" 250 ")).toBe(250);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("-30")).toBe(-30);
  });
  it("rejects what is not a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });
});

describe("planBalance", () => {
  const fields: EditorField[] = [
    { id: "salary", kind: "income", amount: 7000 },
    { id: "rent", kind: "spend", amount: 1850 },
    { id: "food", kind: "spend", amount: 900 },
    { id: "emergency", kind: "savings", amount: 300 },
  ];
  it("subtracts spending and savings from income", () => {
    expect(planBalance(fields, () => null)).toEqual({
      income: 7000,
      spend: 2750,
      savings: 300,
      free: 3950,
    });
  });
  it("uses edited values", () => {
    const b = planBalance(fields, (f) => (f.id === "food" ? 1000 : null));
    expect(b.spend).toBe(2850);
    expect(b.free).toBe(3850);
  });
});

describe("overwrittenMonths", () => {
  const later = [
    { category_id: "food", month: "2026-12-01", amount: 950 },
    { category_id: "food", month: "2026-11-01", amount: 900 },
    { category_id: "food", month: "2027-01-01", amount: 1000 },
    { category_id: "rent", month: "2026-12-01", amount: 1850 },
  ];
  it("lists later months that differ, in order", () => {
    expect(overwrittenMonths(later, "food", "2026-11-01", 1000).map((c) => c.month)).toEqual([
      "2026-12-01",
    ]);
    expect(overwrittenMonths(later, "food", "2026-10-01", 900).map((c) => c.month)).toEqual([
      "2026-12-01",
      "2027-01-01",
    ]);
    expect(overwrittenMonths(later, "rent", "2026-11-01", 1850)).toEqual([]);
  });
});

describe("isChange", () => {
  it("treats invalid input as a change and float noise as none", () => {
    expect(isChange(250, null)).toBe(true);
    expect(isChange(250, 250.001)).toBe(false);
    expect(isChange(250, 260)).toBe(true);
  });
});
