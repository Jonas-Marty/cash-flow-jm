/**
 * Subset-sum matching for reimbursable auto-link suggestions.
 *
 * Given a list of candidate items with positive numeric amounts and a target
 * sum, find the smallest subset whose sum equals the target within a given
 * absolute tolerance. Ties are broken by:
 *   1. fewer items
 *   2. closer to target
 *   3. earlier indices (i.e. order matters — pass candidates sorted by your
 *      preferred ranking, e.g. most-recent first).
 *
 * The brute-force search is bounded: we only consider the first MAX_CANDIDATES
 * items and cap the work at 2^MAX_CANDIDATES combinations (4096 by default).
 */

export const REIMB_MATCH_MAX_CANDIDATES = 12;

export type SubsetMatch = {
  indices: number[];
  total: number;
  exact: boolean;
};

/** Default tolerance: generous — max(0.50, 5% of target).
 *  Refunds frequently round up/down (e.g. 19.55 paid back as 20.00, or
 *  18.55 paid back as 19.95), so we intentionally err on the side of
 *  surfacing a potential match for the user to confirm. */
export function defaultTolerance(target: number): number {
  return Math.max(0.5, Math.abs(target) * 0.05);
}

export function findSubsetSumMatch(
  amounts: number[],
  target: number,
  tolerance: number = defaultTolerance(target),
): SubsetMatch | null {
  if (!isFinite(target) || target <= 0) return null;
  const n = Math.min(amounts.length, REIMB_MATCH_MAX_CANDIDATES);
  if (n === 0) return null;

  let best: SubsetMatch | null = null;

  const total = 1 << n;
  for (let mask = 1; mask < total; mask++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += amounts[i];
        count++;
      }
    }
    const diff = Math.abs(sum - target);
    if (diff > tolerance) continue;
    const exact = diff < 0.005;
    if (
      !best ||
      count < best.indices.length ||
      (count === best.indices.length && diff < Math.abs(best.total - target))
    ) {
      const indices: number[] = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) indices.push(i);
      best = { indices, total: sum, exact };
    }
  }

  return best;
}

/**
 * Spread a settling transaction's amount across the reimbursables it settles.
 *
 * Each link is capped at the original's own remaining, and the running total is
 * capped at what the settling transaction actually pays. Recording the
 * original's full remaining when a smaller refund arrived is what silently
 * flipped partially-repaid IOUs to "settled" and dropped them off the
 * dashboard, so the cap is the correctness guarantee — not a convenience.
 *
 * Selections are consumed in the order given; pass them in the order the user
 * sees them so the leftover lands on the last row.
 */
export function clampLinkAmounts(
  selections: Array<{ id: string; amount: number }>,
  settlingAmount: number,
): Array<{ id: string; amount: number }> {
  if (!isFinite(settlingAmount) || settlingAmount <= 0) return [];
  let budget = settlingAmount;
  const out: Array<{ id: string; amount: number }> = [];
  for (const s of selections) {
    if (budget <= 0.005) break;
    if (!isFinite(s.amount) || s.amount <= 0) continue;
    const amount = Math.round(Math.min(s.amount, budget) * 100) / 100;
    if (amount <= 0) continue;
    out.push({ id: s.id, amount });
    budget -= amount;
  }
  return out;
}

/** Remaining settling amount once `selected` has been allocated. Used to cap
 *  the default when the user ticks one more candidate. */
export function unallocatedSettlingAmount(
  selected: Record<string, number>,
  settlingAmount: number,
): number {
  const used = Object.values(selected).reduce((s, v) => s + (Number(v) || 0), 0);
  const left = (isFinite(settlingAmount) ? settlingAmount : 0) - used;
  return left > 0 ? left : 0;
}
