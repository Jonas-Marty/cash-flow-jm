import { describe, it, expect } from "vitest";
import { scoreAccounts, scoreCategories, scoreTags, sortByPinAndScore, monogram, colorFromName } from "./usageScoring";
import type { Transaction } from "./finance";

const NOW = new Date("2024-06-01T00:00:00Z").getTime();

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: "t",
    type: "expense",
    amount: 0,
    occurred_on: "2024-06-01",
    source_account_id: null,
    destination_account_id: null,
    category_id: null,
    description: null,
    note: null,
  } as unknown as Transaction;
  // overrides applied via Object.assign below
  return { ...({} as Transaction), ...over };
}

function make(over: Partial<Transaction>): Transaction {
  return Object.assign(tx({}), over);
}

describe("scoreAccounts", () => {
  it("weights recent transactions higher than old ones", () => {
    const now = NOW;
    const today = "2024-06-01";
    const oneHalfLifeAgo = "2024-05-02"; // 30 days back ≈ exp(-1)
    const s = scoreAccounts(
      [
        make({ source_account_id: "a", occurred_on: today }),
        make({ source_account_id: "b", occurred_on: oneHalfLifeAgo }),
      ],
      {},
      now,
    );
    expect(s.get("a")).toBeCloseTo(1, 5);
    expect(s.get("b")!).toBeLessThan(0.5);
    expect(s.get("b")!).toBeGreaterThan(0.3);
  });

  it("credits both source and destination accounts on a transfer", () => {
    const s = scoreAccounts(
      [make({ type: "transfer", source_account_id: "a", destination_account_id: "b", occurred_on: "2024-06-01" })],
      {},
      NOW,
    );
    expect(s.get("a")).toBeCloseTo(1, 5);
    expect(s.get("b")).toBeCloseTo(1, 5);
  });
});

describe("scoreCategories", () => {
  it("ignores transactions without a category", () => {
    const s = scoreCategories(
      [make({ category_id: null, occurred_on: "2024-06-01" })],
      {},
      NOW,
    );
    expect(s.size).toBe(0);
  });

  it("sums weights per category", () => {
    const s = scoreCategories(
      [
        make({ category_id: "food", occurred_on: "2024-06-01" }),
        make({ category_id: "food", occurred_on: "2024-06-01" }),
        make({ category_id: "rent", occurred_on: "2024-06-01" }),
      ],
      {},
      NOW,
    );
    expect(s.get("food")).toBeCloseTo(2, 5);
    expect(s.get("rent")).toBeCloseTo(1, 5);
  });
});

describe("sortByPinAndScore", () => {
  it("pinned items come first (respecting pin_order), then by score desc, then name", () => {
    const items = [
      { id: "1", name: "B", pinned: false },
      { id: "2", name: "A", pinned: true, pin_order: 2 },
      { id: "3", name: "C", pinned: true, pin_order: 1 },
      { id: "4", name: "D", pinned: false },
    ];
    const scores = new Map([["1", 5], ["4", 5]]);
    const out = sortByPinAndScore(items, scores).map((i) => i.id);
    // pinned by pin_order: 3, 2 — then unpinned tied on score, sorted by name: B (id 1), D (id 4)
    expect(out).toEqual(["3", "2", "1", "4"]);
  });
});

describe("monogram & colorFromName", () => {
  it("monogram returns the first letter of up to two words", () => {
    expect(monogram("Migros Supermarkt")).toBe("MS");
    expect(monogram("solo")).toBe("S");
    expect(monogram("")).toBe("?");
  });
  it("colorFromName is deterministic", () => {
    expect(colorFromName("Foo")).toBe(colorFromName("Foo"));
  });
});

describe("context-aware scoring", () => {
  it("biases categories toward the selected source account", () => {
    const txs = [
      ...Array.from({ length: 5 }, () =>
        make({ type: "expense", source_account_id: "coop", category_id: "groceries", occurred_on: "2024-06-01" }),
      ),
      ...Array.from({ length: 8 }, () =>
        make({ type: "expense", source_account_id: "bank", category_id: "rent", occurred_on: "2024-06-01" }),
      ),
    ];
    const global = scoreCategories(txs, {}, NOW);
    expect((global.get("rent") ?? 0) > (global.get("groceries") ?? 0)).toBe(true);
    const scoped = scoreCategories(txs, { type: "expense", sourceAccountId: "coop" }, NOW);
    expect((scoped.get("groceries") ?? 0) > (scoped.get("rent") ?? 0)).toBe(true);
    expect(scoped.get("rent")).toBeGreaterThan(0);
  });

  it("biases tags toward the selected category", () => {
    const txs = [
      make({ type: "expense", category_id: "groceries", note: "#migros lunch", occurred_on: "2024-06-01" }),
      make({ type: "expense", category_id: "groceries", note: "#coop dinner", occurred_on: "2024-06-01" }),
      make({ type: "expense", category_id: "groceries", note: "#migros snack", occurred_on: "2024-06-01" }),
      ...Array.from({ length: 6 }, () =>
        make({ type: "expense", category_id: "transport", note: "#sbb", occurred_on: "2024-06-01" }),
      ),
    ];
    const global = scoreTags(txs, {}, NOW);
    expect((global.get("sbb") ?? 0) > (global.get("migros") ?? 0)).toBe(true);
    const scoped = scoreTags(txs, { type: "expense", categoryId: "groceries" }, NOW);
    expect((scoped.get("migros") ?? 0) > (scoped.get("sbb") ?? 0)).toBe(true);
    expect((scoped.get("coop") ?? 0) > (scoped.get("sbb") ?? 0)).toBe(true);
  });

  it("type acts as a hard filter for tags", () => {
    const txs = [
      make({ type: "income", note: "#salary", occurred_on: "2024-06-01" }),
      make({ type: "expense", note: "#coop", occurred_on: "2024-06-01" }),
    ];
    const s = scoreTags(txs, { type: "expense" }, NOW);
    expect(s.get("salary")).toBeUndefined();
    expect(s.get("coop")).toBeGreaterThan(0);
  });
});