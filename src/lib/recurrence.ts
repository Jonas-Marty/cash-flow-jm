/**
 * TypeScript mirror of the SQL recurrence helpers.
 *
 * All calculations are pure date-math and use the *local* `Date` constructor
 * (year/month/day) — same numeric semantics as Postgres `date` values. Never
 * pass a full UTC ISO timestamp through these helpers; use `parseISODate` to
 * lift `YYYY-MM-DD` strings into a `Date` at local midnight.
 */

export type DayRule = "FixedDay" | "LastDay" | "FirstDay";
export type WeekendAdjust = "None" | "PreviousBusinessDay" | "NextBusinessDay";

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * Return the nth anchor date (0-based) obtained by stepping
 * `intervalMonths` from `anchor`'s month and applying `rule`.
 * FixedDay 29/30/31 snaps down in short months but reverts to the full day
 * in longer months.
 */
export function seriesStep(
  anchor: Date,
  rule: DayRule,
  dom: number | null,
  intervalMonths: number,
  n: number,
): Date {
  const baseYear = anchor.getFullYear();
  const baseMonth = anchor.getMonth() + n * intervalMonths;
  const y = baseYear + Math.floor(baseMonth / 12);
  const mRaw = baseMonth % 12;
  const m = mRaw < 0 ? mRaw + 12 : mRaw;
  const last = lastDayOfMonth(y, m);
  if (rule === "FirstDay") return new Date(y, m, 1);
  if (rule === "LastDay") return new Date(y, m, last);
  const d = Math.min(Math.max(1, dom ?? 1), last);
  return new Date(y, m, d);
}

export function weekendShift(date: Date, adj: WeekendAdjust): Date {
  if (adj === "None") return date;
  const dow = date.getDay(); // 0=Sun..6=Sat
  const r = new Date(date);
  if (adj === "PreviousBusinessDay") {
    if (dow === 6) r.setDate(date.getDate() - 1);
    else if (dow === 0) r.setDate(date.getDate() - 2);
  } else {
    if (dow === 6) r.setDate(date.getDate() + 2);
    else if (dow === 0) r.setDate(date.getDate() + 1);
  }
  return r;
}

export interface RuleShape {
  starts_on: string; // YYYY-MM-DD
  ends_on: string | null;
  recurrence_interval: number;
  execution_day_rule: DayRule;
  execution_day_of_month: number | null;
  execution_weekend_adjustment: WeekendAdjust;
  period_day_rule: DayRule;
  period_day_of_month: number | null;
  period_offset: number;
}

/**
 * 1-based index of the execution occurrence with `dueDate` inside the
 * post-skip execution series. Only n=0 can be skipped (when the day-rule
 * anchor lands before `starts_on`).
 */
export function execIndexForDue(r: RuleShape, dueDate: Date): number {
  const starts = parseISODate(r.starts_on);
  const monthsDiff =
    (dueDate.getFullYear() - starts.getFullYear()) * 12 +
    (dueDate.getMonth() - starts.getMonth());
  const nStep = Math.floor(monthsDiff / r.recurrence_interval);
  const firstAnchor = seriesStep(
    starts,
    r.execution_day_rule,
    r.execution_day_of_month,
    r.recurrence_interval,
    0,
  );
  const skip = firstAnchor < starts ? 1 : 0;
  return nStep - skip + 1;
}

export interface PeriodBounds {
  from: Date;
  to: Date;
}

/**
 * Reporting period [from, to] for a given execution due-date. The period
 * series has no "skip before starts_on" filter — the anchor is `starts_on`'s
 * month/year, so period anchor #0 sits in the same month as `starts_on`.
 */
export function periodBoundsForDue(r: RuleShape, dueDate: Date): PeriodBounds {
  const starts = parseISODate(r.starts_on);
  const idx = execIndexForDue(r, dueDate);
  const from = seriesStep(
    starts,
    r.period_day_rule,
    r.period_day_of_month,
    r.recurrence_interval,
    idx - 1 + r.period_offset,
  );
  const nextStart = seriesStep(
    starts,
    r.period_day_rule,
    r.period_day_of_month,
    r.recurrence_interval,
    idx + r.period_offset,
  );
  const to = new Date(nextStart);
  to.setDate(to.getDate() - 1);
  return { from, to };
}

export interface PreviewRow {
  n: number; // 1-based
  due: Date;
  effective: Date;
  periodFrom: Date;
  periodTo: Date;
}

/**
 * Generate the next `count` occurrences starting from index 1. Used for the
 * client-side preview in the rule editor.
 */
export function previewOccurrences(r: RuleShape, count: number, fromDate?: Date): PreviewRow[] {
  const starts = parseISODate(r.starts_on);
  const end = r.ends_on ? parseISODate(r.ends_on) : null;
  const rows: PreviewRow[] = [];
  let n = 0;
  let idx = 0;
  while (idx < count && n < 800) {
    const due = seriesStep(
      starts,
      r.execution_day_rule,
      r.execution_day_of_month,
      r.recurrence_interval,
      n,
    );
    n += 1;
    if (due < starts) continue;
    if (end && due > end) break;
    if (fromDate && due < fromDate) continue;
    const eff = weekendShift(due, r.execution_weekend_adjustment);
    const { from, to } = periodBoundsForDue(r, due);
    idx += 1;
    rows.push({ n: idx, due, effective: eff, periodFrom: from, periodTo: to });
  }
  return rows;
}