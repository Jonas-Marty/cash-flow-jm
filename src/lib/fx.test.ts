import { describe, it, expect } from "vitest";
import { convert, type FxRates } from "./fx";

const rates: FxRates = {
  base: "CHF",
  date: "2024-01-01",
  rates: { EUR: 0.95, USD: 1.1, CHF: 1 },
};

describe("convert", () => {
  it("returns the same amount when from === to", () => {
    expect(convert(100, "CHF", "CHF", rates)).toBe(100);
    expect(convert(100, "EUR", "EUR", undefined)).toBe(100);
  });

  it("converts base → other and other → base", () => {
    expect(convert(100, "CHF", "EUR", rates)).toBeCloseTo(95, 6);
    // 100 EUR back into CHF: 100 / 0.95
    expect(convert(100, "EUR", "CHF", rates)).toBeCloseTo(100 / 0.95, 6);
  });

  it("converts cross currency via the base", () => {
    // 100 EUR → CHF → USD = (100 / 0.95) * 1.1
    expect(convert(100, "EUR", "USD", rates)).toBeCloseTo((100 / 0.95) * 1.1, 6);
  });

  it("returns null when rates are missing", () => {
    expect(convert(100, "CHF", "EUR", undefined)).toBeNull();
    expect(convert(100, "CHF", "JPY", rates)).toBeNull();
    expect(convert(100, "JPY", "CHF", rates)).toBeNull();
  });

  it("returns null for non-finite amounts", () => {
    expect(convert(NaN, "CHF", "EUR", rates)).toBeNull();
    expect(convert(Infinity, "CHF", "EUR", rates)).toBeNull();
  });
});