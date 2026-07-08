import { describe, it, expect } from "vitest";
import {
  seriesStep,
  weekendShift,
  periodBoundsForDue,
  execIndexForDue,
  previewOccurrences,
  parseISODate,
  toISODate,
  type RuleShape,
} from "./recurrence";

const iso = toISODate;

function rule(overrides: Partial<RuleShape>): RuleShape {
  return {
    starts_on: "2026-01-01",
    ends_on: null,
    recurrence_interval: 1,
    execution_day_rule: "FixedDay",
    execution_day_of_month: 1,
    execution_weekend_adjustment: "None",
    period_day_rule: "FixedDay",
    period_day_of_month: 1,
    period_offset: 0,
    ...overrides,
  };
}

describe("seriesStep", () => {
  it("FirstDay always returns day 1 of the stepped month", () => {
    const a = parseISODate("2026-05-10");
    expect(iso(seriesStep(a, "FirstDay", null, 3, 0))).toBe("2026-05-01");
    expect(iso(seriesStep(a, "FirstDay", null, 3, 1))).toBe("2026-08-01");
    expect(iso(seriesStep(a, "FirstDay", null, 3, 3))).toBe("2027-02-01");
  });

  it("LastDay returns last day of the stepped month (leap-Feb aware)", () => {
    const a = parseISODate("2026-01-15");
    expect(iso(seriesStep(a, "LastDay", null, 1, 1))).toBe("2026-02-28");
    const a2 = parseISODate("2024-01-15");
    expect(iso(seriesStep(a2, "LastDay", null, 1, 1))).toBe("2024-02-29");
  });

  it("FixedDay 31 snaps down in short months but reverts in longer ones", () => {
    const a = parseISODate("2026-01-31");
    expect(iso(seriesStep(a, "FixedDay", 31, 1, 1))).toBe("2026-02-28"); // clamp
    expect(iso(seriesStep(a, "FixedDay", 31, 1, 2))).toBe("2026-03-31"); // revert
    expect(iso(seriesStep(a, "FixedDay", 31, 1, 3))).toBe("2026-04-30"); // clamp
  });
});

describe("weekendShift", () => {
  it("None leaves the date untouched", () => {
    const sat = parseISODate("2026-02-28"); // Saturday
    expect(iso(weekendShift(sat, "None"))).toBe("2026-02-28");
  });

  it("PreviousBusinessDay pulls Sat→Fri (stays in Feb across month boundary)", () => {
    const sat = parseISODate("2026-02-28");
    expect(iso(weekendShift(sat, "PreviousBusinessDay"))).toBe("2026-02-27");
  });

  it("PreviousBusinessDay pulls Sun→Fri", () => {
    const sun = parseISODate("2026-03-01"); // Sunday
    expect(iso(weekendShift(sun, "PreviousBusinessDay"))).toBe("2026-02-27");
  });

  it("NextBusinessDay pushes Sat→Mon and Sun→Mon", () => {
    const sat = parseISODate("2026-02-28");
    expect(iso(weekendShift(sat, "NextBusinessDay"))).toBe("2026-03-02");
    const sun = parseISODate("2026-03-01");
    expect(iso(weekendShift(sun, "NextBusinessDay"))).toBe("2026-03-02");
  });
});

describe("Scenario C — Option 2 (StartDate 10.05.26, Interval 3, FixedDay(15)/FirstDay)", () => {
  const r = rule({
    starts_on: "2026-05-10",
    recurrence_interval: 3,
    execution_day_rule: "FixedDay",
    execution_day_of_month: 15,
    period_day_rule: "FirstDay",
    period_day_of_month: null,
  });

  it("execution series yields 15.05, 15.08, 15.11 (no skip; 15.05 ≥ start)", () => {
    const preview = previewOccurrences(r, 3);
    expect(preview.map((p) => iso(p.due))).toEqual([
      "2026-05-15",
      "2026-08-15",
      "2026-11-15",
    ]);
  });

  it("offset 0 pairs exec #1 (15.05) with period 01.05–31.07", () => {
    const p1 = periodBoundsForDue(r, parseISODate("2026-05-15"));
    expect(iso(p1.from)).toBe("2026-05-01");
    expect(iso(p1.to)).toBe("2026-07-31");
    const p2 = periodBoundsForDue(r, parseISODate("2026-08-15"));
    expect(iso(p2.from)).toBe("2026-08-01");
    expect(iso(p2.to)).toBe("2026-10-31");
  });

  it("offset +1 shifts the period one interval forward", () => {
    const rr = { ...r, period_offset: 1 };
    const p1 = periodBoundsForDue(rr, parseISODate("2026-05-15"));
    expect(iso(p1.from)).toBe("2026-08-01");
    expect(iso(p1.to)).toBe("2026-10-31");
    const p2 = periodBoundsForDue(rr, parseISODate("2026-08-15"));
    expect(iso(p2.from)).toBe("2026-11-01");
    expect(iso(p2.to)).toBe("2027-01-31");
  });

  it("offset -2 walks back two intervals (crosses into previous year)", () => {
    const rr = { ...r, period_offset: -2 };
    const p1 = periodBoundsForDue(rr, parseISODate("2026-05-15"));
    expect(iso(p1.from)).toBe("2025-11-01");
    expect(iso(p1.to)).toBe("2026-01-31");
    const p2 = periodBoundsForDue(rr, parseISODate("2026-08-15"));
    expect(iso(p2.from)).toBe("2026-02-01");
    expect(iso(p2.to)).toBe("2026-04-30");
  });
});

describe("Required test scenarios", () => {
  it("Rent LastDay, monthly, start 01.10.26 → period Oct 01–31", () => {
    const r = rule({
      starts_on: "2026-10-01",
      execution_day_rule: "LastDay",
      execution_day_of_month: null,
      period_day_rule: "FirstDay",
      period_day_of_month: null,
    });
    const [first] = previewOccurrences(r, 1);
    expect(iso(first.due)).toBe("2026-10-31");
    expect(iso(first.periodFrom)).toBe("2026-10-01");
    expect(iso(first.periodTo)).toBe("2026-10-31");
  });

  it("Rent LastDay, monthly, start 28.02.26 with weekend PreviousBusinessDay — Feb Sat pulls to Fri 27, still in Feb", () => {
    const r = rule({
      starts_on: "2026-02-01",
      execution_day_rule: "LastDay",
      execution_day_of_month: null,
      execution_weekend_adjustment: "PreviousBusinessDay",
      period_day_rule: "FirstDay",
      period_day_of_month: null,
    });
    const [feb, mar] = previewOccurrences(r, 2);
    expect(iso(feb.due)).toBe("2026-02-28");
    expect(iso(feb.effective)).toBe("2026-02-27");
    expect(iso(feb.periodFrom)).toBe("2026-02-01");
    expect(iso(feb.periodTo)).toBe("2026-02-28");
    // March 31 is a Tuesday — no shift.
    expect(iso(mar.due)).toBe("2026-03-31");
    expect(iso(mar.effective)).toBe("2026-03-31");
  });
});

describe("execIndexForDue", () => {
  it("returns 1 for the first realised execution after the skip filter", () => {
    const r = rule({
      starts_on: "2026-05-10",
      recurrence_interval: 3,
      execution_day_rule: "FirstDay",
      execution_day_of_month: null,
      period_day_rule: "FirstDay",
      period_day_of_month: null,
    });
    // First anchor 01.05 is before start → skipped. 01.08 becomes n=1.
    expect(execIndexForDue(r, parseISODate("2026-08-01"))).toBe(1);
    expect(execIndexForDue(r, parseISODate("2026-11-01"))).toBe(2);
  });
});

describe("previewOccurrences ends_on", () => {
  it("stops when a computed due date crosses ends_on", () => {
    const r = rule({
      starts_on: "2026-01-01",
      ends_on: "2026-03-15",
      execution_day_rule: "FixedDay",
      execution_day_of_month: 10,
      period_day_rule: "FixedDay",
      period_day_of_month: 10,
    });
    const rows = previewOccurrences(r, 12);
    expect(rows.map((r) => iso(r.due))).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
  });
});