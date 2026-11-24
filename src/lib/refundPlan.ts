/**
 * An income that repays expenses: what the user decided per expense, and what
 * that means for the income's own rows.
 *
 * The decisions are made in the income form's "Zahlt Ausgaben zurück" card and
 * applied by the database function apply_refund_links(). This module holds the
 * parts the form needs before saving: which category each part of the income
 * gets (one income row per category), and the payload for the function.
 *
 * Rules (agreed 2026-11-20/21):
 *   - Rest of an expense "still coming": it stays open.
 *   - Rest "my share", written off: expense and income both go to one category.
 *   - Rest "my share", expense split: your share keeps that category, the
 *     reimbursable part and the income have none.
 *   - Refunded in full (or rest still coming): remove the expense's category
 *     (default; the income has none) or book the income to a category.
 *   - Whatever the income brings beyond the expenses goes to the line's own
 *     category, as do links the income already had.
 */

export type RefundRest = "coming" | "mine";
export type RefundHow = "writeoff" | "split";
export type RefundBudget = "remove" | "credit" | "none";

export interface RefundDecision {
  rest: RefundRest;
  how: RefundHow;
  /** Category for your share (write-off: expense and income; split: your line). */
  mineCategoryId: string | null;
  budget: RefundBudget;
  /** Category the income is booked to when budget = credit. */
  incomeCategoryId: string | null;
}

/** One expense an income line repays. No decision: a link it already had. */
export interface RefundPick {
  amount: number;
  decision?: RefundDecision;
}

export type RefundPicks = Record<string, RefundPick>;

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** What a newly picked expense starts with: rest still coming, budget by
 *  removing the expense's category when it has one. */
export function defaultDecision(expense: { category_id: string | null }): RefundDecision {
  return {
    rest: "coming",
    how: "writeoff",
    mineCategoryId: expense.category_id,
    budget: expense.category_id ? "remove" : "none",
    incomeCategoryId: expense.category_id,
  };
}

/** What is left of an expense after this pick. */
export function restOf(open: number, pick: RefundPick): number {
  return r2(open - (Number(pick.amount) || 0));
}

/** The rest is your own share (otherwise it is still coming or there is none). */
export function isMyShare(open: number, pick: RefundPick): boolean {
  return !!pick.decision && pick.decision.rest === "mine" && restOf(open, pick) > 0.005;
}

/** Category the income gets for one pick; undefined = the line's own category. */
export function incomeCategoryFor(open: number, pick: RefundPick): string | null | undefined {
  const d = pick.decision;
  if (!d) return undefined;
  if (isMyShare(open, pick)) return d.how === "split" ? null : d.mineCategoryId;
  return d.budget === "credit" ? d.incomeCategoryId : null;
}

export interface IncomePartLink {
  original_id: string;
  amount: number;
  decision?: RefundDecision;
}

export interface IncomePart {
  categoryId: string | null;
  amount: number;
  links: IncomePartLink[];
  /** Holds the line's own category: the remainder and links it already had. */
  own: boolean;
}

/**
 * Split one income line into parts, one per category. The part with the line's
 * own category comes first, so in an edit it keeps the row's id.
 */
export function planIncomeParts(
  lineAmount: number,
  lineCategoryId: string | null,
  picks: RefundPicks,
  openById: Map<string, number>,
): IncomePart[] {
  const key = (c: string | null) => c ?? "";
  const parts = new Map<string, IncomePart>();
  const order: string[] = [];
  const add = (cat: string | null, amount: number, own: boolean, link?: IncomePartLink) => {
    const k = key(cat);
    let p = parts.get(k);
    if (!p) {
      p = { categoryId: cat, amount: 0, links: [], own: false };
      parts.set(k, p);
      order.push(k);
    }
    p.amount = r2(p.amount + amount);
    if (own) p.own = true;
    if (link) p.links.push(link);
  };

  let linked = 0;
  for (const [id, pick] of Object.entries(picks)) {
    const amount = r2(Number(pick.amount) || 0);
    if (amount <= 0) continue;
    linked = r2(linked + amount);
    const cat = incomeCategoryFor(openById.get(id) ?? amount, pick);
    const link: IncomePartLink = {
      original_id: id,
      amount,
      ...(pick.decision ? { decision: pick.decision } : {}),
    };
    if (cat === undefined) add(lineCategoryId, amount, true, link);
    else add(cat, amount, false, link);
  }
  const remainder = r2(lineAmount - linked);
  if (remainder > 0.005) add(lineCategoryId, remainder, true);

  const ownKey = key(lineCategoryId);
  return [...(parts.has(ownKey) ? [ownKey] : []), ...order.filter((k) => k !== ownKey)]
    .map((k) => parts.get(k)!)
    .filter((p) => p.amount > 0.005);
}

/** The argument apply_refund_links() takes for one income row. */
export function refundLinksPayload(links: IncomePartLink[]): Array<Record<string, unknown>> {
  return links.map((l) => ({
    original_id: l.original_id,
    amount: r2(l.amount),
    ...(l.decision
      ? {
          decision: {
            rest: l.decision.rest,
            how: l.decision.how,
            budget: l.decision.budget,
            category_id: l.decision.mineCategoryId,
          },
        }
      : {}),
  }));
}

/** A pick that cannot be saved as it stands, as an i18n key. */
export function pickIssue(open: number, pick: RefundPick): string | null {
  const amount = Number(pick.amount) || 0;
  if (amount <= 0) return "refund.issue.amount";
  if (amount > open + 0.005) return "refund.issue.more_than_open";
  if (isMyShare(open, pick) && !pick.decision?.mineCategoryId) return "refund.issue.share_category";
  return null;
}

export interface RankableExpense {
  id: string;
  open: number;
  occurred_on: string;
  counterparty: string | null;
}

/**
 * Order for the search list: closest to the amount still to assign, then the
 * person the income comes from, then newest first.
 */
export function rankRefundCandidates<T extends RankableExpense>(
  list: T[],
  target: number | null,
  counterparty: string,
): T[] {
  const cp = counterparty.trim().toLowerCase();
  const dist = (e: T) => (target != null && target > 0 ? Math.abs(e.open - target) : 0);
  const sameCp = (e: T) => (cp && (e.counterparty ?? "").trim().toLowerCase() === cp ? 1 : 0);
  return [...list].sort(
    (a, b) =>
      dist(a) - dist(b) ||
      sameCp(b) - sameCp(a) ||
      (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0),
  );
}

export interface PreviewExpense {
  id: string;
  amount: number;
  category_id: string | null;
  occurred_on: string;
  source_account_id: string;
}

/**
 * What the picks change on the expenses, as preview operations, so the impact
 * card shows the budgets they move. The repayment links are not part of it.
 */
export function refundPreviewOps(
  picks: RefundPicks,
  expenses: Map<string, PreviewExpense>,
  openById: Map<string, number>,
): Array<
  | { op: "insert"; row: Record<string, unknown> }
  | { op: "update"; id: string; row: Record<string, unknown> }
> {
  const ops: Array<
    | { op: "insert"; row: Record<string, unknown> }
    | { op: "update"; id: string; row: Record<string, unknown> }
  > = [];
  for (const [id, pick] of Object.entries(picks)) {
    const d = pick.decision;
    const e = expenses.get(id);
    if (!d || !e) continue;
    const open = openById.get(id) ?? Number(e.amount);
    if (isMyShare(open, pick)) {
      if (!d.mineCategoryId) continue;
      if (d.how === "writeoff") {
        ops.push({ op: "update", id, row: { category_id: d.mineCategoryId } });
      } else {
        const rest = restOf(open, pick);
        ops.push({
          op: "update",
          id,
          row: { amount: r2(Number(e.amount) - rest), category_id: null },
        });
        ops.push({
          op: "insert",
          row: {
            type: "expense",
            amount: rest,
            occurred_on: e.occurred_on,
            source_account_id: e.source_account_id,
            category_id: d.mineCategoryId,
          },
        });
      }
    } else if (d.budget === "remove" && e.category_id) {
      ops.push({ op: "update", id, row: { category_id: null } });
    }
  }
  return ops;
}
