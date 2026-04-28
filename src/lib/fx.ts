import { useQuery } from "@tanstack/react-query";

/**
 * Lightweight FX rates helper using the free, ECB-backed Frankfurter API.
 * No API key required. Rates are cached for 12h via React Query so the
 * dashboard doesn't refetch on every render.
 */

export interface FxRates {
  base: string;
  date: string;
  rates: Record<string, number>; // 1 unit of `base` -> rate units of currency
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

async function fetchRates(base: string): Promise<FxRates> {
  const res = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`);
  if (!res.ok) throw new Error(`FX request failed: ${res.status}`);
  const json = (await res.json()) as { base: string; date: string; rates: Record<string, number> };
  return { base: json.base, date: json.date, rates: { ...json.rates, [json.base]: 1 } };
}

export function useFxRates(base: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["fx", base],
    queryFn: () => fetchRates(base!),
    enabled: !!base && enabled,
    staleTime: TWELVE_HOURS,
    gcTime: TWELVE_HOURS,
    retry: 1,
  });
}

/**
 * Convert `amount` from `from` currency to `to` currency using `rates` keyed
 * by `base`. Returns null if conversion is not possible (missing rate). When
 * `from === to` the amount is returned unchanged.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: FxRates | undefined,
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;
  if (!rates) return null;
  const fromRate = from === rates.base ? 1 : rates.rates[from];
  const toRate = to === rates.base ? 1 : rates.rates[to];
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}
