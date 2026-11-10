/**
 * Amounts in input fields always read with cents ("5.00", not "5" or "2.5"),
 * as everywhere else in the app. Typing stays free; the field is tidied when
 * it is left (`formatAmountInput` on blur) and filled tidy (`amountToInput`).
 */

/** "5" → "5.00", "12,5" → "12.50"; empty or unreadable text is left as typed. */
export function formatAmountInput(raw: string): string {
  const s = raw.trim().replace(",", ".");
  if (s === "" || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return raw;
  const n = Number(s);
  if (!Number.isFinite(n)) return raw;
  // Round half away from zero on the cents, without float drift (1.005 → 1.01).
  const cents = Math.round(Math.abs(n) * 100 + 1e-7) * Math.sign(n);
  return (cents / 100).toFixed(2);
}

/** A stored amount for an input field: "12.50", or "" when there is none. */
export function amountToInput(n: number | string | null | undefined): string {
  if (n == null || n === "") return "";
  const v = Number(n);
  return Number.isFinite(v) ? formatAmountInput(String(v)) : "";
}
