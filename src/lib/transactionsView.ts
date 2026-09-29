import type { Transaction } from "@/lib/finance";

/**
 * What the card view shows as one row: a transaction, or a split group with
 * all of its legs (the group row expands to show them).
 */
export type CardUnit =
  | { kind: "single"; key: string; tx: Transaction }
  | { kind: "group"; key: string; groupId: string; txs: Transaction[] };

/**
 * Rows for the card view, in the order of `sorted`. A split group appears once,
 * where its first leg is, and carries every leg — so a window over these units
 * never cuts a group in half. One pass plus one index, instead of scanning
 * each day's rows for every group.
 */
export function buildCardUnits(sorted: Transaction[]): CardUnit[] {
  const legs = new Map<string, Transaction[]>();
  for (const t of sorted) {
    if (!t.split_group_id) continue;
    const arr = legs.get(t.split_group_id);
    if (arr) arr.push(t);
    else legs.set(t.split_group_id, [t]);
  }
  const seen = new Set<string>();
  const units: CardUnit[] = [];
  for (const t of sorted) {
    const gid = t.split_group_id;
    if (!gid) {
      units.push({ kind: "single", key: t.id, tx: t });
    } else if (!seen.has(gid)) {
      seen.add(gid);
      units.push({ kind: "group", key: `g-${gid}`, groupId: gid, txs: legs.get(gid)! });
    }
  }
  return units;
}

export function unitDate(u: CardUnit): string {
  return u.kind === "single" ? u.tx.occurred_on : u.txs[0].occurred_on;
}

/**
 * Day sections for the card view: consecutive units with the same date share
 * one card. Sorts that are not by date get a single section ("__flat__").
 */
export function groupUnitsByDate(units: CardUnit[], byDate: boolean): [string, CardUnit[]][] {
  if (!byDate) return units.length ? [["__flat__", units]] : [];
  const out: [string, CardUnit[]][] = [];
  for (const u of units) {
    const d = unitDate(u);
    const last = out[out.length - 1];
    if (last && last[0] === d) last[1].push(u);
    else out.push([d, [u]]);
  }
  return out;
}
