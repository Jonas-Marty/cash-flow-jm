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
    original: {
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

describe("pendingEditSearch", () => {
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
