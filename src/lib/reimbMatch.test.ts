import { describe, it, expect } from "vitest";
import { clampLinkAmounts, unallocatedSettlingAmount } from "./reimbMatch";

describe("clampLinkAmounts", () => {
  it("caps a link at what the refund actually paid", () => {
    // The contact-lens case: 132.60 spent, only 17.40 refunded. Recording the
    // original's full remaining is what flipped it to "settled".
    expect(clampLinkAmounts([{ id: "a", amount: 132.6 }], 17.4)).toEqual([
      { id: "a", amount: 17.4 },
    ]);
  });

  it("leaves an exact repayment untouched", () => {
    expect(clampLinkAmounts([{ id: "a", amount: 48.1 }], 48.1)).toEqual([
      { id: "a", amount: 48.1 },
    ]);
  });

  it("never claims more than the original still owes when overpaid", () => {
    // Beer: 19.50 lent, friend hands back 20.00. The extra 0.50 is windfall,
    // not part of the link.
    expect(clampLinkAmounts([{ id: "a", amount: 19.5 }], 20)).toEqual([
      { id: "a", amount: 19.5 },
    ]);
  });

  it("spreads one refund across several originals in order", () => {
    expect(
      clampLinkAmounts(
        [{ id: "a", amount: 417.4 }, { id: "b", amount: 9.95 }],
        427.35,
      ),
    ).toEqual([
      { id: "a", amount: 417.4 },
      { id: "b", amount: 9.95 },
    ]);
  });

  it("truncates the tail once the refund is used up", () => {
    expect(
      clampLinkAmounts(
        [{ id: "a", amount: 100 }, { id: "b", amount: 50 }, { id: "c", amount: 25 }],
        120,
      ),
    ).toEqual([
      { id: "a", amount: 100 },
      { id: "b", amount: 20 },
    ]);
  });

  it("drops non-positive and unusable selections", () => {
    expect(clampLinkAmounts([{ id: "a", amount: 0 }, { id: "b", amount: 5 }], 10))
      .toEqual([{ id: "b", amount: 5 }]);
    expect(clampLinkAmounts([{ id: "a", amount: 5 }], 0)).toEqual([]);
    expect(clampLinkAmounts([{ id: "a", amount: 5 }], Number.NaN)).toEqual([]);
  });

  it("rounds to cents so the sum never drifts past the refund", () => {
    const out = clampLinkAmounts(
      [{ id: "a", amount: 33.333 }, { id: "b", amount: 33.333 }, { id: "c", amount: 33.333 }],
      100,
    );
    const total = out.reduce((s, x) => s + x.amount, 0);
    expect(total).toBeLessThanOrEqual(100.001);
  });
});

describe("unallocatedSettlingAmount", () => {
  it("reports what is left to hand out", () => {
    expect(unallocatedSettlingAmount({ a: 30 }, 100)).toBe(70);
  });

  it("never goes negative", () => {
    expect(unallocatedSettlingAmount({ a: 200 }, 100)).toBe(0);
  });

  it("treats an empty selection as the full amount", () => {
    expect(unallocatedSettlingAmount({}, 42.5)).toBe(42.5);
  });
});
