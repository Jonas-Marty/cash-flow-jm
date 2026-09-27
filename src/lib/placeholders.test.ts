import { describe, expect, it } from "vitest";
import { de, enUS } from "date-fns/locale";
import { interpolate, type PlaceholderContext } from "@/lib/placeholders";

// 2026-06-30 is a Tuesday in Q2 / S1 / T2, ISO week 27.
const d = new Date(2026, 5, 30);
const ctx = (locale = de): PlaceholderContext => ({
  date: d,
  dueDate: d,
  periodFrom: new Date(2026, 3, 1),
  periodTo: d,
  runNumber: 7,
  locale,
});

// Expected values mirror public.format_date_token (the SQL side that writes
// real transactions); the TS side is the preview and the manual-post prefill.
describe("interpolate", () => {
  it.each([
    ["Quartal ${periodTo:Q}", "Quartal 2"],
    ["${periodTo:[Q]Q yyyy}", "Q2 2026"],
    ["S${date:S} T${date:T}", "S1 T2"],
    ["${date:[KW] ww}", "KW 27"],
    ["${date:w}", "27"],
    ["${periodFrom:MMMM yyyy}", "April 2026"],
    ["${periodFrom:MMM}", "Apr"],
    ["${date:dd.MM.yyyy}", "30.06.2026"],
    ["${date:dddd}", "Dienstag"],
    ["${date:[it's] yyyy}", "it's 2026"],
    ["#${runNumber:000}", "#007"],
    ["$$5", "$5"],
  ])("%s → %s", (tpl, expected) => {
    expect(interpolate(tpl, ctx())).toBe(expected);
  });

  it("uses the locale for names", () => {
    expect(interpolate("${periodFrom:MMMM} ${date:ddd}", ctx(enUS))).toBe("April Tue");
  });

  it("keeps unknown tokens visible and strips dropped ones", () => {
    expect(interpolate("${nope} ${quarter}x", ctx())).toBe("${nope} x");
  });
});
