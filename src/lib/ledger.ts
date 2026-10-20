import type { LedgerRow } from "@/lib/finance";

export type LedgerFilter = "all" | "transactions" | "allocations" | "reallocations";

/**
 * What the Verlauf shows as one line: a ledger row, or all leftovers swept in on
 * the same day (one per source envelope), which read as one movement.
 */
export type LedgerItem =
  | { type: "row"; key: string; row: LedgerRow; amount: number; running: number }
  | {
      type: "sweep";
      key: string;
      date: string;
      /** The month the leftovers are from. */
      month: string | null;
      rows: LedgerRow[];
      amount: number;
      running: number;
    };

export type LedgerMonth = {
  /** yyyy-MM-01, or null for the undated opening balance. */
  month: string | null;
  /** Net change over every entry of the month, whatever the filter. */
  net: number;
  items: LedgerItem[];
};

const monthOf = (d: string) => `${d.slice(0, 7)}-01`;

/** Ledger rows (oldest first) as display items, still oldest first. */
export function buildLedgerItems(rows: LedgerRow[]): LedgerItem[] {
  const items: LedgerItem[] = [];
  for (const row of rows) {
    const last = items[items.length - 1];
    if (row.kind === "sweep_in" && row.occurred_on) {
      if (last?.type === "sweep" && last.date === row.occurred_on) {
        last.rows.push(row);
        last.amount += row.amount;
        last.running = row.running_balance;
        continue;
      }
      items.push({
        type: "sweep",
        key: `sweep-${row.occurred_on}`,
        date: row.occurred_on,
        month: row.meta?.month ?? null,
        rows: [row],
        amount: row.amount,
        running: row.running_balance,
      });
      continue;
    }
    items.push({
      type: "row",
      key: row.entry_key,
      row,
      amount: row.amount,
      running: row.running_balance,
    });
  }
  return items;
}

export function itemMatches(item: LedgerItem, filter: LedgerFilter): boolean {
  if (filter === "all") return true;
  if (item.type === "sweep") return filter === "allocations";
  const k = item.row.kind;
  if (filter === "transactions") return k === "transaction";
  if (filter === "reallocations") return k === "reallocation";
  return k === "allocation" || k === "sweep_out" || k === "opening";
}

const itemDate = (i: LedgerItem) => (i.type === "sweep" ? i.date : i.row.occurred_on);

/**
 * Months newest first, items newest first within each. The opening balance has no
 * date and comes last. Months with nothing left after filtering are dropped; their
 * net still counts every entry, so it always matches the balance difference.
 */
export function groupLedgerByMonth(items: LedgerItem[], filter: LedgerFilter): LedgerMonth[] {
  const byMonth = new Map<string, LedgerMonth>();
  const order: string[] = [];
  for (const item of items) {
    const d = itemDate(item);
    const key = d ? monthOf(d) : "opening";
    let m = byMonth.get(key);
    if (!m) {
      m = { month: d ? key : null, net: 0, items: [] };
      byMonth.set(key, m);
      order.push(key);
    }
    m.net += item.amount;
    if (itemMatches(item, filter)) m.items.push(item);
  }
  return order
    .map((k) => byMonth.get(k)!)
    .filter((m) => m.items.length > 0)
    .map((m) => ({ ...m, items: m.items.slice().reverse() }))
    .reverse();
}
