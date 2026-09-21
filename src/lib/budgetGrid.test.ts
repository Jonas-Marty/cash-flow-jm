import { describe, it, expect } from "vitest";
import {
  buildGridGroups,
  cellId,
  effectiveKind,
  isBudgetChange,
  monthWindow,
  needsBulkWrite,
  previewValueFor,
  resolveCells,
} from "./budgetGrid";
import type { Category, CategoryBudgetCell, CategoryGroup, GroupKind } from "./finance";

const cat = (over: Partial<Category> & { id: string }): Category =>
  ({
    name: over.id, allocated_budget: 0, sort_order: 0, archived: false,
    is_scope: false, rolls_over: false, group_id: null, ...over,
  }) as Category;

const grp = (id: string, kind: GroupKind, sort_order: number, name = id): CategoryGroup =>
  ({ id, name, kind, sort_order, archived: false }) as CategoryGroup;

const groups = [grp("gi", "income", 0, "Income"), grp("ge", "expense", 1, "Variable"), grp("gs", "savings", 2, "Savings")];
const kindById = new Map(groups.map((g) => [g.id, g.kind] as const));

describe("effectiveKind", () => {
  it("lets rolls_over win over the group", () => {
    expect(effectiveKind({ rolls_over: true, group_id: "ge" }, kindById)).toBe("savings");
    expect(effectiveKind({ rolls_over: true, group_id: null }, kindById)).toBe("savings");
  });

  it("demotes a non-rolling envelope in a savings group to expense", () => {
    expect(effectiveKind({ rolls_over: false, group_id: "gs" }, kindById)).toBe("expense");
  });

  it("keeps income and expense groups as they are", () => {
    expect(effectiveKind({ rolls_over: false, group_id: "gi" }, kindById)).toBe("income");
    expect(effectiveKind({ rolls_over: false, group_id: "ge" }, kindById)).toBe("expense");
  });

  it("defaults an ungrouped envelope to expense", () => {
    expect(effectiveKind({ rolls_over: false, group_id: null }, kindById)).toBe("expense");
  });
});

describe("buildGridGroups", () => {
  it("excludes scopes and archived envelopes", () => {
    const rows = [
      cat({ id: "food", group_id: "ge" }),
      cat({ id: "trip", group_id: "ge", is_scope: true }),
      cat({ id: "old", group_id: "ge", archived: true }),
    ];
    const out = buildGridGroups(rows, groups);
    expect(out.flatMap((g) => g.rows.map((r) => r.id))).toEqual(["food"]);
  });

  it("orders groups by sort_order and rows within them", () => {
    const rows = [
      cat({ id: "rent", group_id: "ge", sort_order: 2 }),
      cat({ id: "food", group_id: "ge", sort_order: 1 }),
      cat({ id: "salary", group_id: "gi", sort_order: 1 }),
    ];
    const out = buildGridGroups(rows, groups);
    expect(out.map((g) => g.key)).toEqual(["gi", "ge"]);
    expect(out[1].rows.map((r) => r.id)).toEqual(["food", "rent"]);
  });

  it("puts ungrouped envelopes in a synthetic bucket, sorted last", () => {
    const rows = [cat({ id: "loose" }), cat({ id: "food", group_id: "ge" })];
    const out = buildGridGroups(rows, groups);
    expect(out.map((g) => g.key)).toEqual(["ge", "__expense__"]);
  });

  it("groups a rolling envelope by its parent group, not its behaviour", () => {
    // The row's maths follows rolls_over, but the header stays the group it lives in.
    const rows = [cat({ id: "holiday", group_id: "ge", rolls_over: true })];
    const out = buildGridGroups(rows, groups);
    expect(out[0].key).toBe("ge");
    expect(out[0].kind).toBe("expense");
  });
});

describe("monthWindow", () => {
  it("ends at the given month and runs oldest first", () => {
    const w = monthWindow(new Date(2026, 8, 15), 12);
    expect(w).toHaveLength(12);
    expect(w[11]).toEqual(new Date(2026, 8, 1));
    expect(w[0]).toEqual(new Date(2025, 9, 1));
  });

  it("crosses a year boundary", () => {
    const w = monthWindow(new Date(2026, 0, 1), 3);
    expect(w).toEqual([new Date(2025, 10, 1), new Date(2025, 11, 1), new Date(2026, 0, 1)]);
  });
});

describe("resolveCells", () => {
  const months = [new Date(2026, 0, 1), new Date(2026, 1, 1), new Date(2026, 2, 1)];
  const food = cat({ id: "food", allocated_budget: 500 });
  const cell = (month: string, amount: number): CategoryBudgetCell =>
    ({ category_id: "food", month, amount });

  const at = (m: Map<string, { amount: number; inherited: boolean }>, month: string) =>
    m.get(cellId("food", month));

  it("marks a stored month as decided", () => {
    const out = resolveCells([food], [cell("2026-01-01", 600)], months);
    expect(at(out, "2026-01-01")).toEqual({ amount: 600, inherited: false });
  });

  it("carries a stored value forward into undecided months", () => {
    const out = resolveCells([food], [cell("2026-01-01", 600)], months);
    expect(at(out, "2026-02-01")).toEqual({ amount: 600, inherited: true });
    expect(at(out, "2026-03-01")).toEqual({ amount: 600, inherited: true });
  });

  it("falls back to the template when nothing has ever been stored", () => {
    const out = resolveCells([food], [], months);
    for (const m of ["2026-01-01", "2026-02-01", "2026-03-01"]) {
      expect(at(out, m)).toEqual({ amount: 500, inherited: true });
    }
  });

  it("honours a row from before the window rather than the template", () => {
    // The whole reason the caller fetches history: the nearest prior row can be older
    // than the first column, and the database would seed from it, not from the template.
    const out = resolveCells([food], [cell("2025-07-01", 420)], months);
    expect(at(out, "2026-01-01")).toEqual({ amount: 420, inherited: true });
  });

  it("switches to a later stored row mid-window", () => {
    const out = resolveCells([food], [cell("2026-01-01", 600), cell("2026-03-01", 900)], months);
    expect(at(out, "2026-01-01")).toEqual({ amount: 600, inherited: false });
    expect(at(out, "2026-02-01")).toEqual({ amount: 600, inherited: true });
    expect(at(out, "2026-03-01")).toEqual({ amount: 900, inherited: false });
  });

  it("keeps a stored zero as decided rather than inheriting over it", () => {
    const out = resolveCells([food], [cell("2026-02-01", 0)], months);
    expect(at(out, "2026-02-01")).toEqual({ amount: 0, inherited: false });
    expect(at(out, "2026-03-01")).toEqual({ amount: 0, inherited: true });
  });

  it("accepts unsorted input", () => {
    const out = resolveCells([food], [cell("2026-03-01", 900), cell("2026-01-01", 600)], months);
    expect(at(out, "2026-01-01")).toEqual({ amount: 600, inherited: false });
    expect(at(out, "2026-03-01")).toEqual({ amount: 900, inherited: false });
  });

  it("keeps categories independent", () => {
    const rent = cat({ id: "rent", allocated_budget: 1500 });
    const out = resolveCells([food, rent], [cell("2026-01-01", 600)], months);
    expect(out.get(cellId("rent", "2026-01-01"))).toEqual({ amount: 1500, inherited: true });
  });
});

describe("isBudgetChange", () => {
  const stored = { amount: 600, inherited: false };
  const undecided = { amount: 600, inherited: true };

  it("is false when the value is unchanged, whether or not a row exists", () => {
    // The regression: focusing an undecided cell and tabbing away used to count as a
    // change, so moving across the table materialised months and toasted about it.
    expect(isBudgetChange(stored, 600)).toBe(false);
    expect(isBudgetChange(undecided, 600)).toBe(false);
  });

  it("is true for a real change in either direction", () => {
    expect(isBudgetChange(stored, 640)).toBe(true);
    expect(isBudgetChange(undecided, 0)).toBe(true);
  });

  it("ignores float noise below half a cent", () => {
    expect(isBudgetChange(stored, 600.004)).toBe(false);
    expect(isBudgetChange(stored, 600.006)).toBe(true);
  });

  it("treats a cell with no resolution at all as a change", () => {
    expect(isBudgetChange(undefined, 0)).toBe(true);
  });
});

describe("needsBulkWrite", () => {
  it("writes an undecided cell even when the number is the same", () => {
    // Filling right exists to *decide* months, so "inherits 600" must become "is 600".
    expect(needsBulkWrite({ amount: 600, inherited: true }, 600)).toBe(true);
  });

  it("skips a stored cell that already holds the value", () => {
    expect(needsBulkWrite({ amount: 600, inherited: false }, 600)).toBe(false);
  });

  it("writes a stored cell that differs", () => {
    expect(needsBulkWrite({ amount: 600, inherited: false }, 640)).toBe(true);
  });
});

describe("previewValueFor", () => {
  const keys = ["2026-01-01", "2026-02-01", "2026-03-01"];
  const resolved = new Map([
    [cellId("food", "2026-01-01"), { amount: 100, inherited: false }],
    [cellId("food", "2026-02-01"), { amount: 200, inherited: false }],
    [cellId("food", "2026-03-01"), { amount: 300, inherited: false }],
  ]);
  const pv = (p: Parameters<typeof previewValueFor>[0], id: string, col: number) =>
    previewValueFor(p, id, col, keys, resolved);

  it("returns null when nothing is hovered", () => {
    expect(pv(null, "food", 0)).toBeNull();
  });

  describe("row fill", () => {
    const p = { kind: "row", categoryId: "food", fromCol: 1, value: 999 } as const;

    it("covers the source column and everything right of it", () => {
      expect(pv(p, "food", 1)).toBe(999);
      expect(pv(p, "food", 2)).toBe(999);
    });

    it("leaves columns to the left alone", () => {
      expect(pv(p, "food", 0)).toBeNull();
    });

    it("leaves other envelopes alone", () => {
      expect(pv(p, "rent", 2)).toBeNull();
    });
  });

  describe("column fill", () => {
    const p = { kind: "fill", fromCol: 0 } as const;

    it("takes the source column's value, strictly to its right", () => {
      expect(pv(p, "food", 0)).toBeNull();
      expect(pv(p, "food", 1)).toBe(100);
      expect(pv(p, "food", 2)).toBe(100);
    });
  });

  describe("copy from previous", () => {
    it("touches only the target column, taking the one to its left", () => {
      const p = { kind: "copy", fromCol: 2 } as const;
      expect(pv(p, "food", 0)).toBeNull();
      expect(pv(p, "food", 1)).toBeNull();
      expect(pv(p, "food", 2)).toBe(200);
    });

    it("is inert on the leftmost column, which has no previous", () => {
      expect(pv({ kind: "copy", fromCol: 0 }, "food", 0)).toBeNull();
    });
  });
});
