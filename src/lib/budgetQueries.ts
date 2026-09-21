import type { QueryClient } from "@tanstack/react-query";

/**
 * Query keys whose answers depend on `category_budgets`.
 *
 * - `category_month_rows` — the month's allocations.
 * - `category_budget_range` — the grid's own reader.
 * - `savings-balances` — a rolling envelope's balance is the sum of its allocations.
 * - `reconciliation` — the plan gap is computed from every budget row up to the date.
 * - `categories` — the `and later` scope also rewrites `allocated_budget`.
 */
const AFFECTED = new Set([
  "category_month_rows",
  "category_budget_range",
  "savings-balances",
  "reconciliation",
  "categories",
]);

/**
 * Refetches what a budget change actually affects.
 *
 * A bare `invalidateQueries()` marks every query in the app stale, so editing one
 * cell refetched transactions, accounts, pending rows and the audit log too. That is
 * a lot of network for one number, and each refetch is another chance for something
 * on screen to move.
 */
export function invalidateBudgetQueries(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({
    predicate: (q) => AFFECTED.has(String(q.queryKey[0])),
  });
}
