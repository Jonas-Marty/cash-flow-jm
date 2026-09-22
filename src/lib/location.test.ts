import { describe, expect, it } from "vitest";
import { isBetterFix, sameLocation, type TxLocation } from "./location";

const fix = (accuracy_m: number | null, over: Partial<TxLocation> = {}): TxLocation => ({
  latitude: 47.050201,
  longitude: 8.309502,
  accuracy_m,
  label: null,
  source: "device",
  ...over,
});

describe("isBetterFix", () => {
  it("takes a reading when there was nothing at all", () => {
    expect(isBetterFix(null, fix(45))).toBe(true);
  });

  it("takes a far tighter reading over a coarse one", () => {
    // The case this exists for: no GPS at the till, a cell-tower fix, then a
    // real one seconds later.
    expect(isBetterFix(fix(500), fix(30))).toBe(true);
  });

  it("ignores a reading that is only jitter-tighter", () => {
    // Android redelivers notifications. If the client re-takes a fix each time,
    // two readings of the same spot differ by a few metres either way — and
    // every replacement costs a label lookup and another suggestion pass.
    expect(isBetterFix(fix(45), fix(44))).toBe(false);
    expect(isBetterFix(fix(45), fix(40))).toBe(false);
  });

  it("ignores a proportionally small gain on a coarse reading", () => {
    // 20 m better in absolute terms, but 500 m and 480 m are the same claim.
    expect(isBetterFix(fix(500), fix(480))).toBe(false);
  });

  it("ignores a worse reading", () => {
    expect(isBetterFix(fix(30), fix(500))).toBe(false);
  });

  it("ignores an identical reading", () => {
    expect(isBetterFix(fix(45), fix(45))).toBe(false);
  });

  it("treats an unstated accuracy as no evidence, in either direction", () => {
    // Silence is not an improvement: a reading with no accuracy neither
    // replaces a known one nor is replaced by one.
    expect(isBetterFix(fix(500), fix(null))).toBe(false);
    expect(isBetterFix(fix(null), fix(10))).toBe(false);
  });

  it("has nothing to do when no point arrived", () => {
    expect(isBetterFix(fix(500), null)).toBe(false);
    expect(isBetterFix(null, null)).toBe(false);
  });
});

describe("sameLocation", () => {
  it("is true for the same pin", () => {
    expect(sameLocation(fix(45), fix(45))).toBe(true);
  });

  it("compares at the precision the column stores, not the precision given", () => {
    // A value that has been to the database and back is rounded to 6 dp; a
    // freshly measured one is not. Comparing raw floats would call a pin
    // different from itself.
    expect(sameLocation(fix(45), fix(45, { latitude: 47.0502013333 }))).toBe(true);
  });

  it("is false a metre away", () => {
    expect(sameLocation(fix(45), fix(45, { latitude: 47.05021 }))).toBe(false);
  });

  it("is false under a different name — naming a point is a decision", () => {
    expect(sameLocation(fix(45), fix(45, { label: "Coop" }))).toBe(false);
  });

  it("handles nulls without claiming they match a pin", () => {
    expect(sameLocation(null, null)).toBe(true);
    expect(sameLocation(null, fix(45))).toBe(false);
    expect(sameLocation(fix(45), null)).toBe(false);
  });
});
