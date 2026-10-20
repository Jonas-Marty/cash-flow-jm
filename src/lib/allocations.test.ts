import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@/lib/finance";
import { buildMonthMoves, filterMoves, monthNet, moveTotals } from "@/lib/allocations";

const row = (
  kind: LedgerRow["kind"],
  occurred_on: string,
  amount: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow => ({
  entry_key: `${kind}-${occurred_on}-${amount}-${extra.counterpart_category_id ?? ""}`,
  occurred_on,
  kind,
  amount,
  running_balance: 0,
  transaction_id: null,
  reallocation_id: null,
  counterpart_category_id: null,
  account_id: null,
  description: null,
  meta: null,
  ...extra,
});

// September 2026 on the dev copy, trimmed: Sparen is the sweep target.
function ledger() {
  return new Map<string, LedgerRow[]>([
    ["lohn", [row("allocation", "2026-09-01", 7144.45)]],
    [
      "taschengeld",
      [
        row("allocation", "2026-09-01", 626.25),
        row("transaction", "2026-09-05", -15.9),
        // September's own leftover leaves on 1 Oct: not September's move.
        row("sweep_out", "2026-10-01", -158.27, {
          counterpart_category_id: "sparen",
          meta: { month: "2026-09-01" },
        }),
      ],
    ],
    [
      "sparen",
      [
        row("sweep_in", "2026-09-01", 276.83, {
          counterpart_category_id: "taschengeld",
          meta: { month: "2026-08-01", allocated: 626.25, actual: 349.42, income: false },
        }),
        row("sweep_in", "2026-09-01", -375.7, {
          counterpart_category_id: "coiffeur",
          meta: { month: "2026-08-01" },
        }),
        row("allocation", "2026-09-01", 800),
        row("reallocation", "2026-09-20", -487.4, {
          reallocation_id: "r1",
          counterpart_category_id: "pff26",
          description: "Scope close",
        }),
        row("transaction", "2026-09-09", -80),
      ],
    ],
    [
      "pff26",
      [
        row("reallocation", "2026-09-20", 487.4, {
          reallocation_id: "r1",
          counterpart_category_id: "sparen",
        }),
      ],
    ],
  ]);
}

const income = new Set(["lohn"]);

describe("buildMonthMoves", () => {
  it("makes one plan move without income budgets, one leftover move per target, each reallocation once", () => {
    const moves = buildMonthMoves(ledger(), income, "2026-09-01");
    expect(moves.map((m) => m.key)).toEqual(["realloc-r1", "plan", "sweep-sparen"]);
    const plan = moves.find((m) => m.kind === "plan")!;
    expect(plan.parts.map((p) => p.categoryId)).toEqual(["sparen", "taschengeld"]);
    expect(plan.amount).toBeCloseTo(1426.25);
    const sweep = moves.find((m) => m.kind === "sweep")!;
    expect(sweep.toId).toBe("sparen");
    expect(sweep.fromId).toBeNull();
    expect(sweep.amount).toBeCloseTo(-98.87);
    expect(sweep.parts[0]).toMatchObject({
      categoryId: "taschengeld",
      allocated: 626.25,
      actual: 349.42,
    });
    const r = moves.find((m) => m.kind === "realloc")!;
    expect(r).toMatchObject({
      fromId: "sparen",
      toId: "pff26",
      amount: 487.4,
      note: "Scope close",
    });
  });

  it("totals by kind", () => {
    const t = moveTotals(buildMonthMoves(ledger(), income, "2026-09-01"));
    expect(t.plan.count).toBe(2);
    expect(t.sweep).toMatchObject({ count: 2 });
    expect(t.realloc).toEqual({ amount: 487.4, count: 1 });
  });
});

describe("filterMoves", () => {
  const moves = buildMonthMoves(ledger(), income, "2026-09-01");

  it("keeps everything unsigned without a budget", () => {
    expect(filterMoves(moves, "all", null).every((s) => s.signed === null)).toBe(true);
    expect(filterMoves(moves, "realloc", null)).toHaveLength(1);
  });

  it("signs each move from the selected budget's side and shrinks groups to its part", () => {
    const sparen = filterMoves(moves, "all", "sparen");
    expect(sparen.map((s) => [s.move.kind, s.signed])).toEqual([
      ["realloc", -487.4],
      ["plan", 800],
      ["sweep", expect.closeTo(-98.87, 2)],
    ]);
    const tg = filterMoves(moves, "all", "taschengeld");
    expect(tg.map((s) => [s.move.kind, s.signed])).toEqual([
      ["plan", 626.25],
      ["sweep", -276.83],
    ]);
    expect(tg[1].move).toMatchObject({ fromId: "taschengeld", toId: "sparen", amount: 276.83 });
  });
});

describe("monthNet", () => {
  it("adds up the month like the Verlauf, without a leftover that leaves next month", () => {
    const l = ledger();
    expect(monthNet(l.get("sparen"), "2026-09-01")).toBeCloseTo(276.83 - 375.7 + 800 - 487.4 - 80);
    expect(monthNet(l.get("taschengeld"), "2026-09-01")).toBeCloseTo(626.25 - 15.9);
    expect(monthNet(undefined, "2026-09-01")).toBeNull();
  });
});
