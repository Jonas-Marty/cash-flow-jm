import { describe, it, expect } from "vitest";
import { defaultAsOfForMonth, monthParam, monthStatus, parseMonthParam } from "./month";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("monthStatus", () => {
  const today = at(2026, 9, 21);

  it("classifies past, current and future", () => {
    expect(monthStatus(at(2026, 3, 1), today)).toBe("past");
    expect(monthStatus(at(2026, 9, 1), today)).toBe("current");
    expect(monthStatus(at(2027, 1, 1), today)).toBe("future");
  });

  it("ignores the day within the month", () => {
    expect(monthStatus(at(2026, 9, 1), today)).toBe("current");
    expect(monthStatus(at(2026, 9, 30), today)).toBe("current");
  });

  it("treats last month as past even on the first of this one", () => {
    expect(monthStatus(at(2026, 8, 31), at(2026, 9, 1))).toBe("past");
  });
});

describe("defaultAsOfForMonth", () => {
  const today = at(2026, 9, 21);

  it("uses the month's last day for a past month", () => {
    expect(defaultAsOfForMonth(at(2026, 3, 1), today)).toEqual(at(2026, 3, 31));
  });

  it("uses today for the current month, not the month's end", () => {
    expect(defaultAsOfForMonth(at(2026, 9, 1), today)).toEqual(today);
  });

  it("projects to the month's last day for a future month", () => {
    expect(defaultAsOfForMonth(at(2027, 1, 1), today)).toEqual(at(2027, 1, 31));
  });

  it("handles February in a leap year and a common year", () => {
    expect(defaultAsOfForMonth(at(2024, 2, 1), today)).toEqual(at(2024, 2, 29));
    expect(defaultAsOfForMonth(at(2026, 2, 1), today)).toEqual(at(2026, 2, 28));
  });

  it("covers planning January while still in December", () => {
    const december = at(2025, 12, 15);
    expect(monthStatus(at(2026, 1, 1), december)).toBe("future");
    expect(defaultAsOfForMonth(at(2026, 1, 1), december)).toEqual(at(2026, 1, 31));
  });
});

describe("monthParam / parseMonthParam", () => {
  it("round-trips", () => {
    expect(monthParam(at(2026, 1, 1))).toBe("2026-01");
    expect(parseMonthParam("2026-01")).toEqual(at(2026, 1, 1));
    expect(parseMonthParam(monthParam(at(2026, 12, 1)))).toEqual(at(2026, 12, 1));
  });

  it("pads single-digit months", () => {
    expect(monthParam(at(2026, 9, 30))).toBe("2026-09");
  });

  it("falls back to the current month on anything unusable", () => {
    const today = at(2026, 9, 21);
    for (const bad of [undefined, "", "2026", "2026-13", "2026-00", "nonsense", "2026-1"]) {
      expect(parseMonthParam(bad, today)).toEqual(at(2026, 9, 1));
    }
  });
});
