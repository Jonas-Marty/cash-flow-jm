export type AmountOp = "any" | "lt" | "lte" | "eq" | "gte" | "gt" | "around";

export function matchesAmount(
  amount: number,
  op: AmountOp,
  target: number | null,
  tolerancePct: number, // e.g. 0.15 for ±15%
): boolean {
  if (op === "any" || target == null || !Number.isFinite(target)) return true;
  const a = Math.abs(amount);
  const t = Math.abs(target);
  switch (op) {
    case "lt": return a < t;
    case "lte": return a <= t;
    case "eq": return Math.abs(a - t) < 0.005;
    case "gte": return a >= t;
    case "gt": return a > t;
    case "around": {
      if (t === 0) return Math.abs(a) < 0.005;
      return Math.abs(a - t) / t <= tolerancePct;
    }
  }
}
