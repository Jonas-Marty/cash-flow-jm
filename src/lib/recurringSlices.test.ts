import { describe, it, expect } from "vitest";
import {
  computeSliceAmounts,
  detectSliceMode,
  validateSliceTemplate,
} from "./recurringSlices";

describe("detectSliceMode", () => {
  it("returns 'ratio' when any slice has amount_ratio", () => {
    expect(detectSliceMode([
      { amount: null, amount_ratio: 0.5 },
      { amount: 10, amount_ratio: null },
    ])).toBe("ratio");
  });
  it("returns 'fixed' when no slice has ratio", () => {
    expect(detectSliceMode([
      { amount: 10, amount_ratio: null },
      { amount: 20, amount_ratio: null },
    ])).toBe("fixed");
  });
});

describe("computeSliceAmounts: ratio", () => {
  it("splits evenly", () => {
    expect(computeSliceAmounts([
      { amount: null, amount_ratio: 0.5 },
      { amount: null, amount_ratio: 0.5 },
    ], 100)).toEqual([50, 50]);
  });

  it("absorbs rounding remainder into the last slice", () => {
    // 10.01 split 1/3 + 1/3 + 1/3 → [3.34, 3.34, 3.33] with last absorbing
    const got = computeSliceAmounts([
      { amount: null, amount_ratio: 1 / 3 },
      { amount: null, amount_ratio: 1 / 3 },
      { amount: null, amount_ratio: 1 / 3 },
    ], 10.01);
    expect(got.reduce((a, b) => a + b, 0)).toBeCloseTo(10.01, 2);
    expect(got.length).toBe(3);
  });

  it("rejects ratios that don't sum to 1", () => {
    expect(() => computeSliceAmounts([
      { amount: null, amount_ratio: 0.4 },
      { amount: null, amount_ratio: 0.4 },
    ], 100)).toThrow(/sum to 1/);
  });

  it("rejects non-positive ratios", () => {
    expect(() => computeSliceAmounts([
      { amount: null, amount_ratio: 0 },
      { amount: null, amount_ratio: 1 },
    ], 100)).toThrow(/positive ratio/);
  });
});

describe("computeSliceAmounts: fixed", () => {
  it("returns slice amounts when sum matches total", () => {
    expect(computeSliceAmounts([
      { amount: 30, amount_ratio: null },
      { amount: 70, amount_ratio: null },
    ], 100)).toEqual([30, 70]);
  });

  it("rejects mismatched sum", () => {
    expect(() => computeSliceAmounts([
      { amount: 30, amount_ratio: null },
      { amount: 50, amount_ratio: null },
    ], 100)).toThrow(/sum to/);
  });

  it("rejects non-positive amounts", () => {
    expect(() => computeSliceAmounts([
      { amount: 0, amount_ratio: null },
      { amount: 100, amount_ratio: null },
    ], 100)).toThrow(/positive amount/);
  });
});

describe("computeSliceAmounts: invariants", () => {
  it("rejects fewer than 2 slices", () => {
    expect(() => computeSliceAmounts([{ amount: 100, amount_ratio: null }], 100))
      .toThrow(/at least 2/);
  });
  it("rejects non-positive total", () => {
    expect(() => computeSliceAmounts([
      { amount: 50, amount_ratio: null },
      { amount: 50, amount_ratio: null },
    ], 0)).toThrow(/greater than zero/);
  });
});

describe("validateSliceTemplate", () => {
  it("accepts a matching fixed template", () => {
    expect(validateSliceTemplate([
      { amount: 40, amount_ratio: null },
      { amount: 60, amount_ratio: null },
    ], 100)).toBeNull();
  });
  it("skips sum check when rule amount is null (variable)", () => {
    expect(validateSliceTemplate([
      { amount: 40, amount_ratio: null },
      { amount: 60, amount_ratio: null },
    ], null)).toBeNull();
  });
  it("accepts matching ratios", () => {
    expect(validateSliceTemplate([
      { amount: null, amount_ratio: 0.5 },
      { amount: null, amount_ratio: 0.5 },
    ], 100)).toBeNull();
  });
  it("flags non-summing ratios", () => {
    expect(validateSliceTemplate([
      { amount: null, amount_ratio: 0.3 },
      { amount: null, amount_ratio: 0.3 },
    ], 100)).toMatch(/sum to 1/);
  });
});