import { describe, it, expect } from "vitest";
import {
  buildOverview,
  incomeStatus,
  overviewSummary,
  rollingMonth,
  spendStatus,
  spendTotals,
  type SpendRow,
} from "./budgetOverview";
import type { CategoryMonthRow, GroupKind, LedgerRow } from "./finance";

function row(
  p: Partial<CategoryMonthRow> & { category_id: string; kind: CategoryMonthRow["kind"] },
): CategoryMonthRow {
  return {
    category_id: p.category_id,
    name: p.name ?? p.category_id,
    kind: p.kind,
    allocated: p.allocated ?? 0,
    spent_or_received: p.spent_or_received ?? 0,
    variance: 0,
    group_id: p.group_id ?? null,
    group_name: p.group_name ?? null,
    rolls_over: p.rolls_over ?? false,
    is_scope: p.is_scope ?? false,
    sort_order: 0,
    group_sort_order: 0,
  };
}

function led(
  kind: LedgerRow["kind"],
  amount: number,
  running: number,
  on = "2026-10-05",
): LedgerRow {
  return {
    entry_key: `${kind}-${on}-${amount}`,
    occurred_on: on,
    kind,
    amount,
    running_balance: running,
    transaction_id: null,
    reallocation_id: null,
    counterpart_category_id: null,
    account_id: null,
    description: null,
    meta: null,
  };
}

const groupKinds = new Map<string, GroupKind>([
  ["g-inc", "income"],
  ["g-exp", "expense"],
  ["g-sav", "savings"],
]);

describe("spendStatus", () => {
  it("is over only beyond the plan", () => {
    expect(spendStatus(100, 100, 0)).toBe("done");
    expect(spendStatus(100, 100.004, 0)).toBe("done");
    expect(spendStatus(100, 90, 20)).toBe("over");
  });
  it("is idle with nothing booked or pending", () => {
    expect(spendStatus(45, 0, 0)).toBe("idle");
  });
  it("counts pending as spent", () => {
    expect(spendStatus(100, 60, 40)).toBe("done");
    expect(spendStatus(100, 60, 10)).toBe("ok");
  });
  it("is over when a zero plan has bookings", () => {
    expect(spendStatus(0, 24, 0)).toBe("over");
  });
});

describe("incomeStatus", () => {
  it("is done once received and expected reach the target", () => {
    expect(incomeStatus(6800, 6800, 0)).toBe("done");
    expect(incomeStatus(200, 50, 150)).toBe("done");
    expect(incomeStatus(200, 50, 0)).toBe("ok");
    expect(incomeStatus(200, 0, 0)).toBe("idle");
    expect(incomeStatus(10, 12.4, 0)).toBe("done");
  });
});

describe("rollingMonth", () => {
  it("splits the month into what was available and what was spent", () => {
    // Started with 85, got 40 allocated, spent 110.
    const rows = [
      led("allocation", 40, 125, "2026-10-01"),
      led("transaction", -110, 15, "2026-10-12"),
    ];
    expect(rollingMonth(rows, "2026-10-01", 0)).toEqual({ available: 125, spent: 110 });
  });
  it("carries a deficit into the month", () => {
    const rows = [
      led("allocation", 100, 55, "2026-10-01"),
      led("transaction", -70, -15, "2026-10-06"),
    ];
    expect(rollingMonth(rows, "2026-10-01", 0)).toEqual({ available: 55, spent: 70 });
  });
  it("ignores rows outside the month and sweeps out", () => {
    const rows = [
      led("allocation", 40, 125, "2026-10-01"),
      led("sweep_out", -10, 115, "2026-11-01"),
      led("transaction", -5, 110, "2026-11-03"),
    ];
    expect(rollingMonth(rows, "2026-10-01", 0)).toEqual({ available: 125, spent: 0 });
  });
  it("falls back to the balance without rows", () => {
    expect(rollingMonth(undefined, "2026-10-01", 230)).toEqual({ available: 230, spent: 0 });
  });
});

describe("buildOverview", () => {
  const rows = [
    row({
      category_id: "rent",
      kind: "expense",
      group_id: "g-exp",
      group_name: "Wohnen",
      allocated: 1850,
      spent_or_received: 1850,
    }),
    row({
      category_id: "velo",
      kind: "savings",
      rolls_over: true,
      group_id: "g-exp",
      group_name: "Wohnen",
      allocated: 40,
    }),
    row({
      category_id: "salary",
      kind: "income",
      group_id: "g-inc",
      group_name: "Einnahmen",
      allocated: 6800,
      spent_or_received: 6800,
    }),
    row({
      category_id: "emergency",
      kind: "savings",
      rolls_over: true,
      group_id: "g-sav",
      group_name: "Sparen",
      allocated: 300,
    }),
    row({ category_id: "trip", kind: "expense", is_scope: true, allocated: 500 }),
  ];
  const ledger = new Map<string, LedgerRow[]>([
    [
      "velo",
      [led("allocation", 40, 125, "2026-10-01"), led("transaction", -110, 15, "2026-10-12")],
    ],
    [
      "emergency",
      [led("sweep_in", 142.3, 8242.3, "2026-10-01"), led("allocation", 300, 8542.3, "2026-10-01")],
    ],
  ]);
  const groups = buildOverview({
    rows,
    groupKindById: groupKinds,
    pendingMap: new Map([["rent", { expense: 0, income: 0 }]]),
    ledgerByCategory: ledger,
    balanceById: new Map([
      ["velo", 15],
      ["emergency", 8542.3],
    ]),
    month: "2026-10-01",
  });

  it("puts income first and leaves scopes out", () => {
    expect(groups.map((g) => g.name)).toEqual(["Einnahmen", "Wohnen", "Sparen"]);
    expect(groups.flatMap((g) => g.rows).some((r) => r.id === "trip")).toBe(false);
  });

  it("treats a rolling budget in a spending group as spending with carry-over", () => {
    const velo = groups[1].rows.find((r) => r.id === "velo") as SpendRow;
    expect(velo.type).toBe("spend");
    expect(velo.rolling).toBe(true);
    expect(velo.available).toBe(125);
    expect(velo.carry).toBe(85);
    expect(velo.remaining).toBe(15);
    expect(velo.status).toBe("ok");
  });

  it("treats a rolling budget in a savings group as savings", () => {
    const e = groups[2].rows[0];
    expect(e.type).toBe("savings");
    if (e.type === "savings") {
      expect(e.balance).toBe(8542.3);
      expect(e.monthChange).toBeCloseTo(442.3);
    }
  });

  it("keeps rolling budgets out of the monthly summary", () => {
    const s = overviewSummary(groups);
    expect(s.monthly).toEqual({ allocated: 1850, spent: 1850, pending: 0, remaining: 0 });
    expect(s.income).toEqual({ target: 6800, received: 6800 });
    expect(s.overCount).toBe(0);
  });

  it("totals a group's spending rows", () => {
    const t = spendTotals(groups[1].rows);
    expect(t.available).toBe(1975);
    expect(t.remaining).toBe(15);
    expect(t.allDone).toBe(false);
  });
});
