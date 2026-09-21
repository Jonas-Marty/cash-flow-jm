import { endOfMonth, isAfter, isBefore, startOfDay, startOfMonth } from "date-fns";

/**
 * Where a month sits relative to today.
 *
 * Budgets are editable in all three, but they do not mean the same thing: a past
 * month is a correction, the current month is the plan you are living in, and a
 * future month is a plan you are drafting.
 */
export type MonthStatus = "past" | "current" | "future";

export function monthStatus(month: Date, today: Date = new Date()): MonthStatus {
  const a = startOfMonth(month);
  const b = startOfMonth(today);
  if (isBefore(a, b)) return "past";
  if (isAfter(a, b)) return "future";
  return "current";
}

/**
 * The as-of date that belongs with a month being viewed.
 *
 * Past   → the last day of that month, so balances read as they stood at its close.
 * Current→ today, because the month is not over and its close has not happened.
 * Future → the last day of that month, which makes the balances a *projection*.
 *
 * The future case is deliberately a projection rather than today's figures: the point
 * of opening a future month is to ask "if I follow this plan, where do I end up".
 * Callers must label it as such — months that have started but not finished contribute
 * their full unspent allocation to sweeps, because their transactions have not happened.
 *
 * Always start-of-day: the result is shown in a date picker and compared by calendar
 * day, and `endOfMonth` would otherwise hand back 23:59:59.999.
 */
export function defaultAsOfForMonth(month: Date, today: Date = new Date()): Date {
  return startOfDay(monthStatus(month, today) === "current" ? today : endOfMonth(month));
}

/** `YYYY-MM`, the form used in URLs. Distinct from `monthKey()`, which is `YYYY-MM-01`. */
export function monthParam(month: Date): string {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
}

/** Parses `YYYY-MM` back to the first of that month. Invalid input falls back to today. */
export function parseMonthParam(value: string | undefined, today: Date = new Date()): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return startOfMonth(today);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return startOfMonth(today);
  return new Date(year, mon - 1, 1);
}
