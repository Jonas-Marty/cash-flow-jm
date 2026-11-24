import { describe, expect, it } from "vitest";
import {
  defaultDecision,
  planIncomeParts,
  pickIssue,
  rankRefundCandidates,
  refundLinksPayload,
  refundPreviewOps,
  type RefundDecision,
  type RefundPicks,
} from "./refundPlan";

const dec = (over: Partial<RefundDecision> = {}): RefundDecision => ({
  rest: "coming",
  how: "writeoff",
  mineCategoryId: "rest",
  budget: "remove",
  incomeCategoryId: "rest",
  ...over,
});

describe("defaultDecision", () => {
  it("removes the expense's category by default", () => {
    expect(defaultDecision({ category_id: "c" })).toMatchObject({
      rest: "coming",
      budget: "remove",
      mineCategoryId: "c",
    });
  });
  it("asks nothing about the budget for an expense without category", () => {
    expect(defaultDecision({ category_id: null }).budget).toBe("none");
  });
});

describe("planIncomeParts", () => {
  it("exact refund, category removed: one part without category", () => {
    const parts = planIncomeParts(
      45,
      "salary",
      { e: { amount: 45, decision: dec() } },
      new Map([["e", 45]]),
    );
    expect(parts).toEqual([
      {
        categoryId: null,
        amount: 45,
        own: false,
        links: [expect.objectContaining({ original_id: "e", amount: 45 })],
      },
    ]);
  });

  it("book the income to a chosen category", () => {
    const parts = planIncomeParts(
      45,
      null,
      { e: { amount: 45, decision: dec({ budget: "credit", incomeCategoryId: "fun" }) } },
      new Map([["e", 45]]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount])).toEqual([["fun", 45]]);
  });

  it("my share written off: the income goes to the share's category", () => {
    const parts = planIncomeParts(
      60,
      null,
      { e: { amount: 60, decision: dec({ rest: "mine", mineCategoryId: "rest" }) } },
      new Map([["e", 120]]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount])).toEqual([["rest", 60]]);
  });

  it("my share by splitting the expense: the income has no category", () => {
    const parts = planIncomeParts(
      60,
      null,
      { e: { amount: 60, decision: dec({ rest: "mine", how: "split", mineCategoryId: "rest" }) } },
      new Map([["e", 120]]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount])).toEqual([[null, 60]]);
  });

  it("'mine' without a rest falls back to the budget choice", () => {
    const parts = planIncomeParts(
      45,
      null,
      {
        e: {
          amount: 45,
          decision: dec({ rest: "mine", budget: "credit", incomeCategoryId: "fun" }),
        },
      },
      new Map([["e", 45]]),
    );
    expect(parts[0].categoryId).toBe("fun");
  });

  it("different categories split the income; the surplus takes the line's category first", () => {
    const picks: RefundPicks = {
      pizza: { amount: 19.5, decision: dec({ budget: "credit", incomeCategoryId: "rest" }) },
      soap: { amount: 30, decision: dec({ budget: "credit", incomeCategoryId: "home" }) },
    };
    const parts = planIncomeParts(
      50,
      "other",
      picks,
      new Map([
        ["pizza", 19.5],
        ["soap", 30],
      ]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount, p.own])).toEqual([
      ["other", 0.5, true],
      ["rest", 19.5, false],
      ["home", 30, false],
    ]);
  });

  it("a surplus in the same category merges with the refund", () => {
    const parts = planIncomeParts(
      20,
      "rest",
      { p: { amount: 19.5, decision: dec({ budget: "credit", incomeCategoryId: "rest" }) } },
      new Map([["p", 19.5]]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount])).toEqual([["rest", 20]]);
  });

  it("links the income already had stay with the line's category", () => {
    const parts = planIncomeParts(
      100,
      "x",
      { old: { amount: 40 }, nu: { amount: 60, decision: dec() } },
      new Map([
        ["old", 40],
        ["nu", 60],
      ]),
    );
    expect(parts.map((p) => [p.categoryId, p.amount, p.links.map((l) => l.original_id)])).toEqual([
      ["x", 40, ["old"]],
      [null, 60, ["nu"]],
    ]);
  });

  it("no picks: the whole line in its own category", () => {
    expect(planIncomeParts(10, "x", {}, new Map())).toEqual([
      { categoryId: "x", amount: 10, links: [], own: true },
    ]);
  });
});

describe("refundLinksPayload", () => {
  it("sends decisions only for new picks, with the share's category", () => {
    expect(
      refundLinksPayload([
        { original_id: "a", amount: 10 },
        {
          original_id: "b",
          amount: 5.555,
          decision: dec({ rest: "mine", how: "split", mineCategoryId: "c" }),
        },
      ]),
    ).toEqual([
      { original_id: "a", amount: 10 },
      {
        original_id: "b",
        amount: 5.56,
        decision: { rest: "mine", how: "split", budget: "remove", category_id: "c" },
      },
    ]);
  });
});

describe("pickIssue", () => {
  it("needs a category for your share", () => {
    expect(
      pickIssue(120, { amount: 60, decision: dec({ rest: "mine", mineCategoryId: null }) }),
    ).toBe("refund.issue.share_category");
  });
  it("refuses more than is open", () => {
    expect(pickIssue(40, { amount: 41 })).toBe("refund.issue.more_than_open");
  });
  it("accepts a complete pick", () => {
    expect(pickIssue(40, { amount: 40, decision: dec() })).toBeNull();
  });
});

describe("rankRefundCandidates", () => {
  it("closest amount first, then the person, then newest", () => {
    const list = [
      { id: "far", open: 100, occurred_on: "2026-11-10", counterparty: null },
      { id: "old", open: 45, occurred_on: "2026-10-01", counterparty: null },
      { id: "anna", open: 45, occurred_on: "2026-09-01", counterparty: "Anna" },
      { id: "new", open: 45, occurred_on: "2026-11-01", counterparty: null },
    ];
    expect(rankRefundCandidates(list, 45, "anna").map((e) => e.id)).toEqual([
      "anna",
      "new",
      "old",
      "far",
    ]);
  });
});

describe("refundPreviewOps", () => {
  const e = {
    id: "e",
    amount: 120,
    category_id: "rest",
    occurred_on: "2026-11-08",
    source_account_id: "acc",
  };
  const ex = new Map([["e", e]]);
  const open = new Map([["e", 120]]);
  it("removing the category", () => {
    expect(refundPreviewOps({ e: { amount: 120, decision: dec() } }, ex, open)).toEqual([
      { op: "update", id: "e", row: { category_id: null } },
    ]);
  });
  it("splitting off your share", () => {
    expect(
      refundPreviewOps(
        {
          e: { amount: 60, decision: dec({ rest: "mine", how: "split", mineCategoryId: "rest" }) },
        },
        ex,
        open,
      ),
    ).toEqual([
      { op: "update", id: "e", row: { amount: 60, category_id: null } },
      {
        op: "insert",
        row: {
          type: "expense",
          amount: 60,
          occurred_on: "2026-11-08",
          source_account_id: "acc",
          category_id: "rest",
        },
      },
    ]);
  });
  it("booking the income changes nothing on the expense", () => {
    expect(
      refundPreviewOps({ e: { amount: 120, decision: dec({ budget: "credit" }) } }, ex, open),
    ).toEqual([]);
  });
});
