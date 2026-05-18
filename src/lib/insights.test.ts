import { describe, it, expect } from "vitest";
import {
  cv,
  stddev,
  linearRegression,
  topNWithOther,
  monthRange,
  monthKeyOf,
  aggregateMonthly,
  normalizeMerchant,
  type BreakdownSlice,
} from "./insights";
import type { Transaction } from "./finance";

describe("statistical helpers", () => {
  it("stddev of constant series is 0", () => {
    expect(stddev([5, 5, 5])).toBe(0);
  });

  it("stddev of [1,2,3,4,5] is sqrt(2)", () => {
    expect(stddev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 6);
  });

  it("stddev of empty list is 0", () => {
    expect(stddev([])).toBe(0);
  });

  it("cv of empty list is Infinity", () => {
    expect(cv([])).toBe(Infinity);
  });

  it("cv handles zero mean by returning Infinity", () => {
    expect(cv([-1, 1])).toBe(Infinity);
  });

  it("cv = std/|mean| for normal data", () => {
    expect(cv([10, 10, 10])).toBeCloseTo(0, 6);
    expect(cv([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2) / 3, 6);
  });

  it("linearRegression recovers a known slope/intercept", () => {
    // y = 2x + 1 for x = 0..4
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    const { slope, intercept } = linearRegression(pts);
    expect(slope).toBeCloseTo(2, 6);
    expect(intercept).toBeCloseTo(1, 6);
  });

  it("linearRegression with <2 points returns zero slope", () => {
    expect(linearRegression([])).toEqual({ slope: 0, intercept: 0 });
    expect(linearRegression([{ x: 1, y: 7 }])).toEqual({ slope: 0, intercept: 7 });
  });
});

describe("topNWithOther", () => {
  const slices = (vals: number[]): BreakdownSlice[] =>
    vals.map((v, i) => ({ key: `k${i}`, label: `L${i}`, value: v, count: 1 }));

  it("returns input unchanged when length <= topN", () => {
    const s = slices([10, 5]);
    expect(topNWithOther(s, 3, "Other")).toHaveLength(2);
  });

  it("aggregates the tail into an Other slice", () => {
    const s = slices([10, 9, 8, 7, 6]);
    const out = topNWithOther(s, 3, "Other");
    expect(out).toHaveLength(4);
    expect(out[3].label).toBe("Other");
    expect(out[3].value).toBe(13); // 7 + 6
    expect(out[3].count).toBe(2);
  });

  it("omits the Other slice when it would be zero", () => {
    const s = [
      { key: "a", label: "A", value: 5, count: 1 },
      { key: "b", label: "B", value: 0, count: 0 },
    ];
    const out = topNWithOther(s, 1, "Other");
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("a");
  });

  it("sorts descending by value before splitting", () => {
    const s = slices([1, 100, 50]);
    const out = topNWithOther(s, 2, "Other");
    expect(out.map((x) => x.value)).toEqual([100, 50, 1]);
  });
});

describe("monthRange / monthKeyOf", () => {
  it("monthKeyOf returns YYYY-MM", () => {
    expect(monthKeyOf(new Date(2024, 2, 15))).toBe("2024-03");
  });

  it("inclusive month range across a year boundary", () => {
    const r = monthRange("2023-11-15", "2024-02-01");
    expect(r).toEqual(["2023-11", "2023-12", "2024-01", "2024-02"]);
  });

  it("single-month range when from/to are in the same month", () => {
    expect(monthRange("2024-05-01", "2024-05-28")).toEqual(["2024-05"]);
  });
});

describe("aggregateMonthly", () => {
  const tx = (over: Partial<Transaction>): Transaction =>
    ({
      id: "t",
      type: "expense",
      amount: 0,
      occurred_on: "2024-01-15",
      source_account_id: "a",
      destination_account_id: null,
      category_id: null,
      description: null,
      note: null,
      ...over,
    }) as unknown as Transaction;

  it("buckets income / expense per month and ignores transfers", () => {
    const out = aggregateMonthly(
      [
        tx({ type: "income", amount: 5000, occurred_on: "2024-01-05" }),
        tx({ type: "expense", amount: 1500, occurred_on: "2024-01-20" }),
        tx({ type: "expense", amount: 200, occurred_on: "2024-02-02" }),
        tx({ type: "transfer", amount: 1000, occurred_on: "2024-01-10" }),
      ],
      "2024-01-01",
      "2024-02-28",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ month: "2024-01", income: 5000, expense: 1500, net: 3500 });
    expect(out[1]).toEqual({ month: "2024-02", income: 0, expense: 200, net: -200 });
  });

  it("drops transactions outside the requested range", () => {
    const out = aggregateMonthly(
      [tx({ type: "expense", amount: 100, occurred_on: "2023-12-31" })],
      "2024-01-01",
      "2024-01-31",
    );
    expect(out[0].expense).toBe(0);
  });
});

describe("normalizeMerchant", () => {
  it("lowercases, strips digits and punctuation", () => {
    expect(normalizeMerchant("Migros #food 1234 CHF")).toBe("migros");
    expect(normalizeMerchant("STARBUCKS - Zurich HB 12.50")).toBe("starbucks zurich hb");
  });
  it("returns empty string for null/empty", () => {
    expect(normalizeMerchant(null)).toBe("");
    expect(normalizeMerchant("")).toBe("");
  });
});