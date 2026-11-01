/**
 * The months before the one on screen, per budget, for the small bar chart in an
 * expanded row.
 *
 * Each month is judged against the plan it had then, not today's: raising a
 * budget in July must not repaint May as overspent.
 */

export interface HistoryPoint {
  /** `YYYY-MM-01`. */
  month: string;
  /**
   * spending: booked expenses minus income bookings on the budget (refunds);
   * income: received; savings: change of the balance over the month.
   */
  value: number;
  /** The month's plan, or null for savings, which have no target. */
  plan: number | null;
}

export interface HistoryTx {
  category_id: string;
  type: "expense" | "income" | "transfer";
  /** In the main currency. */
  amount: number;
  occurred_on: string;
}

export interface HistoryInput {
  /** `YYYY-MM-01`, oldest first. */
  months: string[];
  categories: { id: string; kind: "spend" | "income" | "savings" }[];
  /** The plan of a category in a month; undefined when unknown. */
  planOf: (categoryId: string, month: string) => number | undefined;
  txs: HistoryTx[];
  /**
   * Month-end balance of a savings budget, keyed `YYYY-MM`. Needs the month before
   * the first one too, to compute the first change.
   */
  savingsBalance: (categoryId: string, ym: string) => number | undefined;
}

export function prevMonthKey(month: string, n = 1): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The `count` months before `month`, oldest first. */
export function monthsBefore(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => prevMonthKey(month, count - i));
}

export function buildHistory(input: HistoryInput): Map<string, HistoryPoint[]> {
  const { months, categories, planOf, txs, savingsBalance } = input;
  const sums = new Map<string, { expense: number; income: number }>();
  for (const t of txs) {
    if (t.type === "transfer") continue;
    const key = `${t.category_id}:${t.occurred_on.slice(0, 7)}`;
    const s = sums.get(key) ?? { expense: 0, income: 0 };
    if (t.type === "expense") s.expense += t.amount;
    else s.income += t.amount;
    sums.set(key, s);
  }

  const out = new Map<string, HistoryPoint[]>();
  for (const c of categories) {
    const points: HistoryPoint[] = [];
    for (const month of months) {
      const ym = month.slice(0, 7);
      if (c.kind === "savings") {
        const end = savingsBalance(c.id, ym);
        const start = savingsBalance(c.id, prevMonthKey(month).slice(0, 7));
        points.push({
          month,
          value: end != null && start != null ? end - start : (end ?? 0),
          plan: null,
        });
        continue;
      }
      const s = sums.get(`${c.id}:${ym}`) ?? { expense: 0, income: 0 };
      points.push({
        month,
        value: c.kind === "income" ? s.income : s.expense - s.income,
        plan: planOf(c.id, month) ?? 0,
      });
    }
    out.set(c.id, points);
  }
  return out;
}

export function historyAverage(points: HistoryPoint[]): number {
  if (points.length === 0) return 0;
  return points.reduce((s, p) => s + p.value, 0) / points.length;
}
