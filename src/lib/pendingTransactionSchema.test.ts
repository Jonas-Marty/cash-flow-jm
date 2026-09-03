import { describe, it, expect } from "vitest";
import {
  pendingTransactionInputSchema,
  normalizePendingTransactionInput,
} from "./pendingTransactionSchema";

const UUID_A = "11111111-1111-1111-1111-111111111111";

const base = { source_account_id: UUID_A, amount: "12.50" };

function parse(extra: Record<string, unknown>) {
  return pendingTransactionInputSchema.safeParse({ ...base, ...extra });
}

describe("pending transaction location", () => {
  it("accepts a fix from a capturing device", () => {
    const r = parse({
      latitude: 47.050168,
      longitude: 8.309307,
      location_accuracy_m: 42,
      location_source: "device",
    });
    expect(r.success).toBe(true);
  });

  it("defaults the source to device when a point is given without one", () => {
    const r = parse({ latitude: 47.05, longitude: 8.31 });
    expect(r.success).toBe(true);
    expect(normalizePendingTransactionInput(r.data!).location_source).toBe("device");
  });

  it("rejects a latitude without a longitude", () => {
    expect(parse({ latitude: 47.05 }).success).toBe(false);
    expect(parse({ longitude: 8.31 }).success).toBe(false);
  });

  it("rejects coordinates outside the globe", () => {
    expect(parse({ latitude: 91, longitude: 8.31 }).success).toBe(false);
    expect(parse({ latitude: 47.05, longitude: -181 }).success).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(parse({ latitude: 47.05, longitude: 8.31, location_source: "gps" }).success).toBe(false);
  });

  it("rounds to six decimals, matching round6 in lib/location", () => {
    const r = parse({ latitude: 47.0501681234, longitude: 8.3093071234 });
    const out = normalizePendingTransactionInput(r.data!);
    expect(out.latitude).toBe(47.050168);
    expect(out.longitude).toBe(8.309307);
  });

  it("nulls the whole group when no point is given, so a label cannot survive alone", () => {
    const r = parse({ location_label: "Coop Luzern", location_accuracy_m: 30 });
    expect(r.success).toBe(true);
    const out = normalizePendingTransactionInput(r.data!);
    expect(out.latitude).toBeNull();
    expect(out.location_label).toBeNull();
    expect(out.location_accuracy_m).toBeNull();
    expect(out.location_source).toBeNull();
  });

  it("still accepts a payload with no location at all", () => {
    const r = parse({});
    expect(r.success).toBe(true);
    expect(normalizePendingTransactionInput(r.data!).latitude).toBeNull();
  });
});
