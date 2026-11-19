import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import type { PendingTransaction } from "@/lib/finance";
import {
  changedFields,
  originalValues,
  pendingEditSearch,
  valuesFromRow,
  valuesToColumns,
} from "@/lib/pendingEdits";

const row = (over: Partial<PendingTransaction> = {}): PendingTransaction =>
  ({
    id: "p1",
    type: "expense",
    amount: 12.5,
    occurred_on: "2026-11-18",
    description: "Migros",
    note: null,
    category_id: null,
    source_account_id: "acc-1",
    latitude: 47.1,
    longitude: 8.5,
    location_accuracy_m: 20,
    location_label: "Migros Bahnhof",
    location_source: "device",
    destination_account_id: null,
    destination_amount: null,
    original: {
      type: "expense",
      destination_account_id: null,
      destination_amount: null,
      amount: 12.5,
      occurred_on: "2026-11-18",
      description: "Migros",
      note: null,
      category_id: null,
      source_account_id: "acc-1",
      latitude: 47.1,
      longitude: 8.5,
      location_accuracy_m: 20,
      location_label: "Migros Bahnhof",
      location_source: "device",
    },
    ...over,
  }) as PendingTransaction;

describe("changedFields", () => {
  it("is empty for an untouched row", () => {
    const p = row();
    expect(changedFields(p, valuesFromRow(p))).toEqual([]);
  });

  it("compares amounts as numbers and text after trimming", () => {
    const p = row();
    const v = { ...valuesFromRow(p), amount: "12.5", description: " Migros " };
    expect(changedFields(p, v)).toEqual([]);
  });

  it("lists what differs, in field order", () => {
    const p = row();
    const v = { ...valuesFromRow(p), source_account_id: "acc-2", amount: "13", location: null };
    expect(changedFields(p, v)).toEqual(["amount", "source_account_id", "location"]);
  });

  it("counts a type change, and the transfer target only for transfers", () => {
    const p = row();
    const v = { ...valuesFromRow(p), type: "transfer" as const, destination_account_id: "acc-9" };
    expect(changedFields(p, v)).toEqual(["type", "destination_account_id"]);
    // Back to an expense: a target left over from the detour is not a change.
    expect(changedFields(p, { ...v, type: "expense" })).toEqual([]);
  });

  it("does not call the type changed on a snapshot from before it was kept", () => {
    const p = row({ type: "income" });
    const orig = { ...(p.original as object) } as Record<string, unknown>;
    delete orig.type;
    const q = { ...p, original: orig } as PendingTransaction;
    expect(changedFields(q, valuesFromRow(q))).toEqual([]);
  });

  it("is empty for a row without a snapshot", () => {
    const p = row({ original: null });
    expect(changedFields(p, { ...valuesFromRow(p), description: "x" })).toEqual([]);
  });

  it("reads the snapshot back as input values", () => {
    expect(originalValues(row())?.amount).toBe("12.50");
  });
});

describe("valuesToColumns", () => {
  it("leaves out an amount that does not parse", () => {
    expect(valuesToColumns({ amount: "1.2.3" })).toEqual({});
    expect(valuesToColumns({ amount: "0" })).toEqual({});
    expect(valuesToColumns({ amount: "" })).toEqual({});
    expect(valuesToColumns({ amount: "12,345" })).toEqual({ amount: 12.35 });
  });

  it("stores empty text and no category as null", () => {
    expect(valuesToColumns({ description: "  ", note: "", category_id: "" })).toEqual({
      description: null,
      note: null,
      category_id: null,
    });
  });

  it("writes every place column, also to clear it", () => {
    expect(valuesToColumns({ location: null })).toEqual({
      latitude: null,
      longitude: null,
      location_accuracy_m: null,
      location_label: null,
      location_source: null,
    });
  });
});

describe("valuesToColumns, transfers", () => {
  it("writes type, target and a cleared or parsed received amount", () => {
    expect(
      valuesToColumns({ type: "transfer", destination_account_id: "", destination_amount: "" }),
    ).toEqual({ type: "transfer", destination_account_id: null, destination_amount: null });
    expect(valuesToColumns({ destination_amount: "9,5" })).toEqual({ destination_amount: 9.5 });
    expect(valuesToColumns({ destination_amount: "1.2.3" })).toEqual({});
  });
});

describe("pendingEditSearch", () => {
  it("carries the current type and transfer target instead of a category", () => {
    const p = row({ category_id: "cat-1" });
    const v = {
      ...valuesFromRow(p),
      type: "transfer" as const,
      destination_account_id: "acc-2",
      destination_amount: "11",
    };
    const s = pendingEditSearch(p, v);
    expect(s).toMatchObject({ type: "transfer", dest: "acc-2", dest_amount: "11.00" });
    expect(s.category).toBeUndefined();
  });

  it("carries account and place to /add", () => {
    const p = row();
    const s = pendingEditSearch(p, valuesFromRow(p));
    expect(s).toMatchObject({
      pending_id: "p1",
      source: "acc-1",
      amount: "12.50",
      lat: "47.1",
      lng: "8.5",
      acc: "20",
      place: "Migros Bahnhof",
      loc_source: "device",
    });
  });
});
