import { describe, expect, it } from "vitest";

import { accountOpeningsTotal, holdsOpening, parseOpening } from "./openingBalances";

describe("parseOpening", () => {
  it("reads Swiss and decimal-comma amounts", () => {
    expect(parseOpening("1'000.50")).toBe(1000.5);
    expect(parseOpening("1000,5")).toBe(1000.5);
    expect(parseOpening(" -200 ")).toBe(-200);
  });
  it("treats empty as 0 and garbage as invalid", () => {
    expect(parseOpening("")).toBe(0);
    expect(parseOpening("-")).toBe(0);
    expect(parseOpening("abc")).toBeNull();
  });
});

describe("accountOpeningsTotal", () => {
  it("sums every account, archived ones too, to the cent", () => {
    expect(
      accountOpeningsTotal([
        { opening_balance: "0.1" },
        { opening_balance: 0.2 },
        { opening_balance: null },
      ]),
    ).toBe(0.3);
  });
});

describe("holdsOpening", () => {
  it("is only rolling budgets that are not scopes", () => {
    expect(holdsOpening({ rolls_over: true, is_scope: false })).toBe(true);
    expect(holdsOpening({ rolls_over: true, is_scope: true })).toBe(false);
    expect(holdsOpening({ rolls_over: false, is_scope: false })).toBe(false);
  });
});
