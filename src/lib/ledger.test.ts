import { describe, expect, it } from "vitest";
import type { LedgerRow } from "@/lib/finance";
import { buildLedgerItems, groupLedgerByMonth } from "@/lib/ledger";

let running = 0;
const row = (
  kind: LedgerRow["kind"],
  occurred_on: string | null,
  amount: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow => {
  running += amount;
  return {
    entry_key: `${kind}-${occurred_on}-${amount}`,
    occurred_on,
    kind,
    amount,
    running_balance: running,
    transaction_id: null,
    reallocation_id: null,
    counterpart_category_id: null,
    account_id: null,
    description: null,
    meta: null,
    ...extra,
  };
};

function sample() {
  running = 0;
  return [
    row("opening", null, 1000),
    row("sweep_in", "2026-09-01", 150, { meta: { month: "2026-08-01" } }),
    row("sweep_in", "2026-09-01", -35.5, { meta: { month: "2026-08-01" } }),
    row("allocation", "2026-09-01", 800),
    row("transaction", "2026-09-09", -80),
    row("reallocation", "2026-09-20", -487.4),
    row("sweep_in", "2026-10-01", 69, { meta: { month: "2026-09-01" } }),
    row("allocation", "2026-10-01", 800),
  ];
}

describe("buildLedgerItems", () => {
  it("merges the leftovers of one day into one item that ends on its last running balance", () => {
    const items = buildLedgerItems(sample());
    expect(items.map((i) => i.type)).toEqual(["row", "sweep", "row", "row", "row", "sweep", "row"]);
    const sweep = items[1];
    expect(sweep.type === "sweep" && sweep.rows.length).toBe(2);
    expect(sweep.amount).toBeCloseTo(114.5);
    expect(sweep.running).toBeCloseTo(1114.5);
    expect(sweep.type === "sweep" && sweep.month).toBe("2026-08-01");
  });
});

describe("groupLedgerByMonth", () => {
  it("lists months and items newest first, the undated opening last", () => {
    const months = groupLedgerByMonth(buildLedgerItems(sample()), "all");
    expect(months.map((m) => m.month)).toEqual(["2026-10-01", "2026-09-01", null]);
    expect(months[0].items.map((i) => i.key)).toEqual([
      "allocation-2026-10-01-800",
      "sweep-2026-10-01",
    ]);
    expect(months[1].net).toBeCloseTo(114.5 + 800 - 80 - 487.4);
  });

  it("keeps the full net of a month when filtering, and drops months left empty", () => {
    const months = groupLedgerByMonth(buildLedgerItems(sample()), "transactions");
    expect(months).toHaveLength(1);
    expect(months[0].items).toHaveLength(1);
    expect(months[0].net).toBeCloseTo(114.5 + 800 - 80 - 487.4);
  });

  it("counts allocations, leftovers and the opening balance as allocations", () => {
    const months = groupLedgerByMonth(buildLedgerItems(sample()), "allocations");
    expect(
      months.flatMap((m) => m.items.map((i) => (i.type === "sweep" ? "sweep" : i.row.kind))),
    ).toEqual(["allocation", "sweep", "allocation", "sweep", "opening"]);
  });
});
