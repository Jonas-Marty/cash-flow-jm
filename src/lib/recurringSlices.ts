/**
 * Pure math + validation helpers for recurring-rule slices.
 *
 * A "slice" is one component of a split recurring rule. When the rule posts,
 * we fan it out into N transactions sharing a `split_group_id`.
 *
 * Two amount modes are supported:
 *  - Fixed:  every slice carries an explicit `amount`. The total must match
 *            the rule's `amount` (or, for variable-amount rules, the amount
 *            entered at posting time).
 *  - Ratio:  slices carry `amount_ratio` (e.g. 0.5 + 0.5). The runtime total
 *            is multiplied by each ratio; any rounding remainder is absorbed
 *            by the last slice so the sum matches the total to the cent.
 */

export interface SliceTemplate {
  amount: number | null;
  amount_ratio: number | null;
}

export type SliceMode = "fixed" | "ratio";

/** Round to 2 decimals (cents). Avoids float drift like 1.155 → 1.16. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Decide the slice mode for a rule. Ratios win when ANY slice has a ratio. */
export function detectSliceMode(slices: SliceTemplate[]): SliceMode {
  return slices.some((s) => s.amount_ratio != null) ? "ratio" : "fixed";
}

/**
 * Compute the per-slice amounts that should be posted given a runtime total.
 * The returned array has the same length and order as `slices`.
 *
 * Throws when the slices are invalid for the given total.
 */
export function computeSliceAmounts(slices: SliceTemplate[], total: number): number[] {
  if (!Array.isArray(slices) || slices.length < 2) {
    throw new Error("A split rule needs at least 2 slices");
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Total must be greater than zero");
  }
  const mode = detectSliceMode(slices);

  if (mode === "ratio") {
    const ratios = slices.map((s) => Number(s.amount_ratio ?? 0));
    if (ratios.some((r) => !Number.isFinite(r) || r <= 0)) {
      throw new Error("Every slice needs a positive ratio");
    }
    const sum = ratios.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.0001) {
      throw new Error("Slice ratios must sum to 1");
    }
    const out = ratios.map((r) => round2(total * r));
    // Absorb rounding drift into the last slice so the sum matches the total.
    const drift = round2(total - out.reduce((a, b) => a + b, 0));
    if (drift !== 0) out[out.length - 1] = round2(out[out.length - 1] + drift);
    return out;
  }

  // Fixed mode
  const amounts = slices.map((s) => Number(s.amount ?? NaN));
  if (amounts.some((a) => !Number.isFinite(a) || a <= 0)) {
    throw new Error("Every slice needs a positive amount");
  }
  const sum = round2(amounts.reduce((a, b) => a + b, 0));
  if (sum !== round2(total)) {
    throw new Error(`Slice amounts (${sum}) must sum to total (${round2(total)})`);
  }
  return amounts.map(round2);
}

/**
 * Validate a rule's slice template at edit time. Returns null when valid,
 * otherwise an error message suitable for inline display.
 *
 * For variable-amount rules, `ruleAmount` is null and only ratio sum / fixed
 * positivity is checked. For fixed-amount rules, the slice sum must match.
 */
export function validateSliceTemplate(
  slices: SliceTemplate[],
  ruleAmount: number | null,
): string | null {
  if (slices.length < 2) return "At least 2 slices are required";
  const mode = detectSliceMode(slices);
  if (mode === "ratio") {
    const sum = slices.reduce((a, b) => a + Number(b.amount_ratio ?? 0), 0);
    if (Math.abs(sum - 1) > 0.0001) return "Ratios must sum to 1";
    if (slices.some((s) => !Number.isFinite(Number(s.amount_ratio)) || Number(s.amount_ratio) <= 0)) {
      return "Every slice ratio must be greater than zero";
    }
    return null;
  }
  if (slices.some((s) => !Number.isFinite(Number(s.amount)) || Number(s.amount ?? 0) <= 0)) {
    return "Every slice amount must be greater than zero";
  }
  if (ruleAmount != null) {
    const sum = round2(slices.reduce((a, b) => a + Number(b.amount ?? 0), 0));
    if (sum !== round2(ruleAmount)) return `Slice amounts (${sum}) must sum to ${round2(ruleAmount)}`;
  }
  return null;
}