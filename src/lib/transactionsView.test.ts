import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/finance";
import { buildCardUnits, groupUnitsByDate } from "@/lib/transactionsView";

const tx = (id: string, occurred_on: string, split_group_id: string | null = null) =>
  ({ id, occurred_on, split_group_id }) as unknown as Transaction;

describe("buildCardUnits", () => {
  it("keeps singles in order and folds a split group into one unit at its first leg", () => {
    const units = buildCardUnits([
      tx("a", "2026-09-25"),
      tx("s1", "2026-09-24", "g"),
      tx("b", "2026-09-24"),
      tx("s2", "2026-09-24", "g"),
      tx("c", "2026-09-23"),
    ]);
    expect(units.map((u) => u.key)).toEqual(["a", "g-g", "b", "c"]);
    const g = units[1];
    expect(g.kind === "group" && g.txs.map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("never splits a group across a window boundary", () => {
    // The second leg sorts far behind the first; the window of 1 unit still has both.
    const sorted = [tx("s1", "2026-09-24", "g"), ...Array.from({ length: 50 }, (_, i) => tx(`x${i}`, "2026-09-20")), tx("s2", "2026-09-24", "g")];
    const [first] = buildCardUnits(sorted).slice(0, 1);
    expect(first.kind === "group" && first.txs.length).toBe(2);
  });
});

describe("groupUnitsByDate", () => {
  const units = buildCardUnits([tx("a", "2026-09-25"), tx("b", "2026-09-25"), tx("c", "2026-09-24")]);

  it("one section per consecutive day", () => {
    expect(groupUnitsByDate(units, true).map(([d, us]) => [d, us.length])).toEqual([
      ["2026-09-25", 2],
      ["2026-09-24", 1],
    ]);
  });

  it("a single flat section for other sorts, none for no rows", () => {
    expect(groupUnitsByDate(units, false).map(([d, us]) => [d, us.length])).toEqual([["__flat__", 3]]);
    expect(groupUnitsByDate([], false)).toEqual([]);
  });
});
