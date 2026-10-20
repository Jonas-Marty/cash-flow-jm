import type { LedgerRow } from "@/lib/finance";

/**
 * The Zuteilungen view: every movement of money between budgets in one month, built
 * from the same month ledger as the budget cards and the Verlauf.
 *
 *   plan     the month's allocations, one move from the plan to every budget
 *   sweep    last month's leftovers arriving in a sweep target, one move per target
 *   realloc  one reallocation (Umschichten, scope close, archive move)
 *
 * Income budgets are not allocated anything (their plan is the money coming in),
 * and a monthly budget's own leftover leaving it is the same movement as the
 * sweep arriving next month, so only the arrival is listed.
 */
/** Select value for "Nicht zugeordnet", the empty side of a reallocation. */
export const UNASSIGNED_ENVELOPE = "__unassigned__";

export type MoveKind = "plan" | "sweep" | "realloc";
export type MoveFilter = "all" | MoveKind;

export type MovePart = {
  categoryId: string;
  amount: number;
  /** Leftovers only: what the source was allocated and what it spent (or received). */
  allocated?: number;
  actual?: number;
  income?: boolean;
};

export type Move = {
  key: string;
  date: string;
  kind: MoveKind;
  /** null for the plan, or for a leftover move with several sources. */
  fromId: string | null;
  /** null for the plan to several budgets. */
  toId: string | null;
  amount: number;
  note: string | null;
  reallocationId: string | null;
  /** Plan: each budget's allocation. Leftovers: each source. Empty for a reallocation. */
  parts: MovePart[];
};

const ORDER: Record<MoveKind, number> = { sweep: 1, plan: 2, realloc: 3 };

/** Moves of `month` (yyyy-MM-01), newest first. */
export function buildMonthMoves(
  ledger: Map<string, LedgerRow[]>,
  incomeIds: Set<string>,
  month: string,
): Move[] {
  const prefix = month.slice(0, 7);
  const inMonth = (r: LedgerRow) => !!r.occurred_on && r.occurred_on.startsWith(prefix);
  const plan: MovePart[] = [];
  let planDate = month;
  const moves: Move[] = [];
  const reallocs = new Map<string, Move>();

  for (const [categoryId, rows] of ledger) {
    const swept: MovePart[] = [];
    let sweptDate = month;
    for (const r of rows) {
      if (!inMonth(r)) continue;
      if (r.kind === "allocation" && !incomeIds.has(categoryId)) {
        plan.push({ categoryId, amount: r.amount });
        planDate = r.occurred_on!;
      } else if (r.kind === "sweep_in" && r.counterpart_category_id) {
        swept.push({
          categoryId: r.counterpart_category_id,
          amount: r.amount,
          allocated: r.meta?.allocated != null ? Number(r.meta.allocated) : undefined,
          actual: r.meta?.actual != null ? Number(r.meta.actual) : undefined,
          income: r.meta?.income ?? undefined,
        });
        sweptDate = r.occurred_on!;
      } else if (
        r.kind === "reallocation" &&
        r.reallocation_id &&
        !reallocs.has(r.reallocation_id)
      ) {
        // Each reallocation is in the ledger of both budgets; take it once.
        const inflow = r.amount > 0;
        reallocs.set(r.reallocation_id, {
          key: `realloc-${r.reallocation_id}`,
          date: r.occurred_on!,
          kind: "realloc",
          fromId: inflow ? r.counterpart_category_id : categoryId,
          toId: inflow ? categoryId : r.counterpart_category_id,
          amount: Math.abs(r.amount),
          note: r.description,
          reallocationId: r.reallocation_id,
          parts: [],
        });
      }
    }
    if (swept.length > 0) {
      swept.sort((a, b) => b.amount - a.amount);
      moves.push({
        key: `sweep-${categoryId}`,
        date: sweptDate,
        kind: "sweep",
        fromId: swept.length === 1 ? swept[0].categoryId : null,
        toId: categoryId,
        amount: swept.reduce((s, p) => s + p.amount, 0),
        note: null,
        reallocationId: null,
        parts: swept,
      });
    }
  }
  if (plan.length > 0) {
    plan.sort((a, b) => b.amount - a.amount);
    moves.push({
      key: "plan",
      date: planDate,
      kind: "plan",
      fromId: null,
      toId: plan.length === 1 ? plan[0].categoryId : null,
      amount: plan.reduce((s, p) => s + p.amount, 0),
      note: null,
      reallocationId: null,
      parts: plan,
    });
  }
  moves.push(...reallocs.values());
  return moves.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? 1
        : -1
      : ORDER[b.kind] - ORDER[a.kind] || (a.key < b.key ? -1 : 1),
  );
}

/** A move as the list shows it; `signed` is set when one budget is selected. */
export type ShownMove = { move: Move; signed: number | null };

/**
 * Narrow to one kind and/or one budget. For a budget, a group move shrinks to that
 * budget's own part, and every amount gets the sign it has for that budget, so the
 * list reads like the budget's own history.
 */
export function filterMoves(
  moves: Move[],
  kind: MoveFilter,
  categoryId: string | null,
): ShownMove[] {
  const out: ShownMove[] = [];
  for (const m of moves) {
    if (kind !== "all" && m.kind !== kind) continue;
    if (!categoryId) {
      out.push({ move: m, signed: null });
      continue;
    }
    if (m.kind === "realloc") {
      if (m.toId === categoryId) out.push({ move: m, signed: m.amount });
      else if (m.fromId === categoryId) out.push({ move: m, signed: -m.amount });
      continue;
    }
    if (m.kind === "sweep" && m.toId === categoryId) {
      out.push({ move: m, signed: m.amount });
      continue;
    }
    const part = m.parts.find((p) => p.categoryId === categoryId);
    if (!part) continue;
    out.push({
      move:
        m.kind === "plan"
          ? {
              ...m,
              key: `${m.key}-${categoryId}`,
              toId: categoryId,
              amount: part.amount,
              parts: [part],
            }
          : {
              ...m,
              key: `${m.key}-${categoryId}`,
              fromId: categoryId,
              amount: part.amount,
              parts: [part],
            },
      signed: m.kind === "plan" ? part.amount : -part.amount,
    });
  }
  return out;
}

export type MoveTotals = {
  plan: { amount: number; count: number };
  sweep: { amount: number; count: number };
  realloc: { amount: number; count: number };
};

export function moveTotals(moves: Move[]): MoveTotals {
  const t: MoveTotals = {
    plan: { amount: 0, count: 0 },
    sweep: { amount: 0, count: 0 },
    realloc: { amount: 0, count: 0 },
  };
  for (const m of moves) {
    if (m.kind === "plan") {
      t.plan.amount += m.amount;
      t.plan.count += m.parts.length;
    } else if (m.kind === "sweep") {
      t.sweep.amount += m.amount;
      t.sweep.count += m.parts.length;
    } else {
      t.realloc.amount += m.amount;
      t.realloc.count += 1;
    }
  }
  return t;
}

/** Net change of one budget over the month, as the Verlauf counts it. */
export function monthNet(rows: LedgerRow[] | undefined, month: string): number | null {
  if (!rows) return null;
  const prefix = month.slice(0, 7);
  return rows.reduce(
    (s, r) => (r.kind !== "sweep_out" && r.occurred_on?.startsWith(prefix) ? s + r.amount : s),
    0,
  );
}
