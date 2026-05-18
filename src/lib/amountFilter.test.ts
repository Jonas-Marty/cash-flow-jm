import { describe, it, expect } from "vitest";
import { matchesAmount } from "./amountFilter";

describe("matchesAmount", () => {
  it("'any' matches everything (incl. null target)", () => {
    expect(matchesAmount(123, "any", null, 0.1)).toBe(true);
    expect(matchesAmount(0, "any", 50, 0.1)).toBe(true);
  });

  it("returns true when target is null or non-finite", () => {
    expect(matchesAmount(10, "eq", null, 0)).toBe(true);
    expect(matchesAmount(10, "eq", NaN, 0)).toBe(true);
  });

  it("uses absolute value of both amount and target", () => {
    expect(matchesAmount(-100, "eq", 100, 0)).toBe(true);
    expect(matchesAmount(100, "eq", -100, 0)).toBe(true);
  });

  it("lt / lte boundaries", () => {
    expect(matchesAmount(99, "lt", 100, 0)).toBe(true);
    expect(matchesAmount(100, "lt", 100, 0)).toBe(false);
    expect(matchesAmount(100, "lte", 100, 0)).toBe(true);
  });

  it("gt / gte boundaries", () => {
    expect(matchesAmount(101, "gt", 100, 0)).toBe(true);
    expect(matchesAmount(100, "gt", 100, 0)).toBe(false);
    expect(matchesAmount(100, "gte", 100, 0)).toBe(true);
  });

  it("eq uses a 0.005 tolerance for cent rounding", () => {
    expect(matchesAmount(100.004, "eq", 100, 0)).toBe(true);
    expect(matchesAmount(100.01, "eq", 100, 0)).toBe(false);
  });

  it("around uses percentage tolerance", () => {
    expect(matchesAmount(110, "around", 100, 0.1)).toBe(true);  // exactly 10%
    expect(matchesAmount(111, "around", 100, 0.1)).toBe(false);
    expect(matchesAmount(90, "around", 100, 0.1)).toBe(true);
  });

  it("around with zero target matches only ~zero", () => {
    expect(matchesAmount(0, "around", 0, 0.1)).toBe(true);
    expect(matchesAmount(0.004, "around", 0, 0.1)).toBe(true);
    expect(matchesAmount(1, "around", 0, 0.1)).toBe(false);
  });
});