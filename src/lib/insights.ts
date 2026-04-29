/**
 * Pure aggregation, projection, and detection helpers used by the
 * Insights page. No data fetching or React here — keep it testable.
 */
import type { Transaction, RecurringRule } from "@/lib/finance";

export type GroupKey = "category" | "group" | "tag" | "account" | "type";
export type TxFilter = "expense" | "income" | "both";

export interface BreakdownSlice {
  key: string;        // stable key (id or tag/account name)
  label: string;      // display label
  value: number;      // positive sum
  count: number;      // number of contributing tx
  color?: string;
}

export interface MonthPoint {
  month: string;       // "YYYY-MM"
  income: number;
  expense: number;
  net: number;         // income - expense
}

export interface NetWorthPoint {
  date: string;        // ISO end-of-month
  netWorth: number;
  assets: number;
  liabilities: number;
}

/** Normalize a description for "same merchant" grouping. */
export function normalizeMerchant(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[#@].*/g, "")
    .replace(/\d+[\d./,-]*/g, "") // strip numbers, dates, amounts
    .replace(/[^a-z0-9äöüß ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coefficient of variation (std/mean), guarded for empty/zero input. */
export function cv(values: number[]): number {
  if (values.length === 0) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (Math.abs(mean) < 1e-6) return Infinity;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/** Simple ordinary least-squares linear regression: returns slope+intercept. */
export function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0 };
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxx = points.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/** Standard deviation of a number list (population). */
export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length,
  );
}

const TX_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Stable color picker — same key always gets the same color. */
export function colorForIndex(i: number): string {
  return TX_PALETTE[i % TX_PALETTE.length];
}

/**
 * Aggregate a flat list of slices into top-N + "Other".
 * Sort descending, keep `topN`, lump the rest under one "Other" slice.
 */
export function topNWithOther(
  slices: BreakdownSlice[],
  topN: number,
  otherLabel: string,
): BreakdownSlice[] {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  if (sorted.length <= topN) return sorted;
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  const other: BreakdownSlice = {
    key: "__other__",
    label: otherLabel,
    value: tail.reduce((a, s) => a + s.value, 0),
    count: tail.reduce((a, s) => a + s.count, 0),
    color: "var(--muted-foreground)",
  };
  return other.value > 0 ? [...head, other] : head;
}

export function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Build a sequence of months between two dates (inclusive of both ends). */
export function monthRange(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const a = new Date(fromISO);
  const b = new Date(toISO);
  const cur = new Date(a.getFullYear(), a.getMonth(), 1);
  const end = new Date(b.getFullYear(), b.getMonth(), 1);
  while (cur <= end) {
    out.push(monthKeyOf(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/**
 * Aggregate transactions into monthly income/expense buckets.
 * Transfers are excluded (they net to zero).
 */
export function aggregateMonthly(
  tx: Transaction[],
  fromISO: string,
  toISO: string,
): MonthPoint[] {
  const buckets = new Map<string, MonthPoint>();
  for (const k of monthRange(fromISO, toISO)) {
    buckets.set(k, { month: k, income: 0, expense: 0, net: 0 });
  }
  for (const t of tx) {
    if (t.type === "transfer") continue;
    const k = t.occurred_on.slice(0, 7);
    const bucket = buckets.get(k);
    if (!bucket) continue;
    if (t.type === "income") bucket.income += Number(t.amount) || 0;
    else bucket.expense += Number(t.amount) || 0;
  }
  for (const b of buckets.values()) b.net = b.income - b.expense;
  return Array.from(buckets.values());
}

/**
 * Project net worth forward from historical net-worth snapshots.
 * Returns combined actual + three projection series.
 */
export interface ProjectionPoint {
  date: string;            // ISO month-end
  actual?: number;
  trend?: number;
  avg?: number;
  recurring?: number;
  bandLow?: number;
  bandHigh?: number;
}

export function buildProjection(
  history: NetWorthPoint[],
  monthsAhead: number,
  recurringMonthlyNet: number,
): { points: ProjectionPoint[]; summary: { trendEnd: number; avgEnd: number; recurringEnd: number; band: number; avgMonthlyNet: number; trendSlope: number } } {
  const points: ProjectionPoint[] = history.map((p) => ({
    date: p.date,
    actual: p.netWorth,
  }));
  if (history.length === 0) {
    return {
      points,
      summary: { trendEnd: 0, avgEnd: 0, recurringEnd: 0, band: 0, avgMonthlyNet: 0, trendSlope: 0 },
    };
  }

  // Compute monthly deltas for avg/std
  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push(history[i].netWorth - history[i - 1].netWorth);
  }
  const avgMonthlyNet = deltas.length
    ? deltas.reduce((a, b) => a + b, 0) / deltas.length
    : 0;
  const band = stddev(deltas);

  // Linear regression on history (x = month index, y = net worth)
  const reg = linearRegression(history.map((p, i) => ({ x: i, y: p.netWorth })));

  const last = history[history.length - 1];
  const lastDate = new Date(last.date);

  // Anchor projections to actual last value (no jump)
  for (let i = 1; i <= monthsAhead; i++) {
    const d = new Date(lastDate.getFullYear(), lastDate.getMonth() + i + 1, 0);
    const trend = reg.intercept + reg.slope * (history.length - 1 + i);
    const avg = last.netWorth + avgMonthlyNet * i;
    const recurring = last.netWorth + recurringMonthlyNet * i;
    points.push({
      date: d.toISOString().slice(0, 10),
      trend,
      avg,
      recurring,
      bandLow: trend - band * Math.sqrt(i),
      bandHigh: trend + band * Math.sqrt(i),
    });
  }

  return {
    points,
    summary: {
      trendEnd: points[points.length - 1].trend ?? last.netWorth,
      avgEnd: points[points.length - 1].avg ?? last.netWorth,
      recurringEnd: points[points.length - 1].recurring ?? last.netWorth,
      band,
      avgMonthlyNet,
      trendSlope: reg.slope,
    },
  };
}

export interface RecurringCandidate {
  key: string;
  label: string;
  occurrences: number;
  monthsCovered: number;
  avgAmount: number;
  cv: number;
  lastSeen: string;
  totalAmount: number;
  txIds: string[];
}

/**
 * Find recurring-looking expense groups not already linked to a recurring rule.
 * Defaults: ≥3 occurrences, ≥3 distinct months, CV < 0.30 (stable amount).
 */
export function detectRecurringCandidates(
  tx: Transaction[],
  rules: RecurringRule[],
  opts: { minOccurrences?: number; minMonths?: number; maxCv?: number } = {},
): RecurringCandidate[] {
  const minOcc = opts.minOccurrences ?? 3;
  const minMonths = opts.minMonths ?? 3;
  const maxCv = opts.maxCv ?? 0.3;

  // Names that already have a rule — skip.
  const ruledNames = new Set(
    rules
      .filter((r) => !r.archived)
      .map((r) => normalizeMerchant(r.description ?? r.name)),
  );

  const groups = new Map<
    string,
    {
      label: string;
      amounts: number[];
      months: Set<string>;
      lastSeen: string;
      txIds: string[];
    }
  >();

  for (const t of tx) {
    if (t.type !== "expense") continue;
    if (t.recurring_rule_id) continue;
    const norm = normalizeMerchant(t.description);
    if (!norm || norm.length < 3) continue;
    if (ruledNames.has(norm)) continue;
    const g = groups.get(norm) ?? {
      label: t.description ?? norm,
      amounts: [],
      months: new Set<string>(),
      lastSeen: t.occurred_on,
      txIds: [],
    };
    g.amounts.push(Number(t.amount) || 0);
    g.months.add(t.occurred_on.slice(0, 7));
    if (t.occurred_on > g.lastSeen) g.lastSeen = t.occurred_on;
    g.txIds.push(t.id);
    groups.set(norm, g);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [key, g] of groups) {
    if (g.amounts.length < minOcc) continue;
    if (g.months.size < minMonths) continue;
    const variation = cv(g.amounts);
    if (variation > maxCv) continue;
    const total = g.amounts.reduce((a, b) => a + b, 0);
    candidates.push({
      key,
      label: g.label,
      occurrences: g.amounts.length,
      monthsCovered: g.months.size,
      avgAmount: total / g.amounts.length,
      cv: variation,
      lastSeen: g.lastSeen,
      totalAmount: total,
      txIds: g.txIds,
    });
  }
  candidates.sort((a, b) => b.totalAmount - a.totalAmount);
  return candidates;
}