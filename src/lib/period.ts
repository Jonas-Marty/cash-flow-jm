export type PeriodKey = "this_month" | "last_month" | "ytd" | "last_12mo" | "last_24mo" | "all";

export function periodToRange(p: PeriodKey): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (p === "this_month") {
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (p === "last_month") {
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
  }
  if (p === "ytd") {
    return {
      from: iso(new Date(today.getFullYear(), 0, 1)),
      to: iso(today),
    };
  }
  if (p === "last_12mo") {
    return {
      from: iso(new Date(today.getFullYear() - 1, today.getMonth(), 1)),
      to: iso(today),
    };
  }
  if (p === "last_24mo") {
    return {
      from: iso(new Date(today.getFullYear() - 2, today.getMonth(), 1)),
      to: iso(today),
    };
  }
  return { from: "1970-01-01", to: iso(today) };
}
