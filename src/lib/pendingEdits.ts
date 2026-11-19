/**
 * Edits made on /pending, saved onto the pending row as they are typed.
 *
 * Both views of /pending (the table and the cards) edit the same fields and
 * read them back from the same query cache, so leaving the page — to open a
 * row in /add, to switch views, to close the tab — no longer throws an edit
 * away. Each change is patched into the cache at once and written to the
 * database after a short pause; a blur, a pick from a menu, the pencil and the
 * tab going away write it straight off.
 *
 * `original` on the row is what arrived, written once by the database; the
 * row is compared against it to show what was changed and to put it back.
 */
import type { QueryClient } from "@tanstack/react-query";
import * as React from "react";

import { supabase } from "@/integrations/supabase/client";
import { formatAmountInput } from "@/lib/amountInput";
import type { PendingTransaction } from "@/lib/finance";
import { locationFromRow, locationToColumns, sameLocation, type TxLocation } from "@/lib/location";

/** The fields a /pending row lets you edit, as the inputs hold them. */
export type PendingValues = {
  /** As typed: "12.50", or something that does not parse yet. */
  amount: string;
  occurred_on: string;
  description: string;
  note: string;
  /** "" for none. */
  category_id: string;
  source_account_id: string;
  location: TxLocation | null;
};

export type PendingField = keyof PendingValues;

/** The row as it arrived, written by the database on insert. */
export type PendingOriginal = {
  amount: number | string | null;
  occurred_on: string | null;
  description: string | null;
  note: string | null;
  category_id: string | null;
  source_account_id: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  location_accuracy_m: number | string | null;
  location_label: string | null;
  location_source: string | null;
};

/** Order the fields are listed in, wherever they are listed. */
export const PENDING_FIELDS: PendingField[] = [
  "amount",
  "occurred_on",
  "description",
  "note",
  "category_id",
  "source_account_id",
  "location",
];

export function valuesFromRow(p: PendingTransaction): PendingValues {
  return {
    // Cash amounts, so always with the cents: 10.00, not 10.
    amount: Number(p.amount).toFixed(2),
    occurred_on: p.occurred_on,
    description: p.description ?? "",
    note: p.note ?? "",
    category_id: p.category_id ?? "",
    source_account_id: p.source_account_id,
    location: locationFromRow(p),
  };
}

/** What the row held when it arrived, or null for a row from before the snapshot. */
export function originalValues(p: PendingTransaction): PendingValues | null {
  const o = p.original;
  if (!o) return null;
  const amount = Number(o.amount);
  return {
    amount: Number.isFinite(amount) ? amount.toFixed(2) : "",
    occurred_on: o.occurred_on ?? "",
    description: o.description ?? "",
    note: o.note ?? "",
    category_id: o.category_id ?? "",
    source_account_id: o.source_account_id ?? "",
    location: locationFromRow(o),
  };
}

/** The amount as a number, or null while it does not read as one above zero. */
export function parseAmount(raw: string): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function sameField(f: PendingField, a: PendingValues, b: PendingValues): boolean {
  switch (f) {
    case "amount": {
      const x = parseAmount(a.amount);
      const y = parseAmount(b.amount);
      return x == null || y == null ? a.amount.trim() === b.amount.trim() : x === y;
    }
    case "location":
      return sameLocation(a.location, b.location);
    default:
      return String(a[f] ?? "").trim() === String(b[f] ?? "").trim();
  }
}

/** Fields that differ from what arrived; none for a row without a snapshot. */
export function changedFields(p: PendingTransaction, current: PendingValues): PendingField[] {
  const orig = originalValues(p);
  if (!orig) return [];
  return PENDING_FIELDS.filter((f) => !sameField(f, orig, current));
}

/**
 * Database columns for a set of changed values. An amount that does not parse
 * is left out: the field keeps showing what was typed, the row keeps the last
 * amount that made sense, and confirming still explains what is wrong.
 */
export function valuesToColumns(v: Partial<PendingValues>): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (v.amount !== undefined) {
    const n = parseAmount(v.amount);
    if (n != null) cols.amount = n;
  }
  if (v.occurred_on !== undefined && v.occurred_on) cols.occurred_on = v.occurred_on;
  if (v.description !== undefined) cols.description = v.description.trim() || null;
  if (v.note !== undefined) cols.note = v.note.trim() || null;
  if (v.category_id !== undefined) cols.category_id = v.category_id || null;
  if (v.source_account_id !== undefined && v.source_account_id) {
    cols.source_account_id = v.source_account_id;
  }
  if (v.location !== undefined) Object.assign(cols, locationToColumns(v.location));
  return cols;
}

/**
 * The /add deep link that opens a row in the booking form with everything the
 * row shows: amount, date, description, note, category, account and place.
 */
export function pendingEditSearch(
  p: Pick<PendingTransaction, "id" | "type">,
  v: PendingValues,
): Record<string, string> {
  const search: Record<string, string> = {
    pending_id: p.id,
    type: p.type,
    amount: formatAmountInput(v.amount),
    occurred_on: v.occurred_on,
  };
  if (v.source_account_id) search.source = v.source_account_id;
  if (v.category_id && p.type !== "transfer") search.category = v.category_id;
  if (v.description.trim()) search.description = v.description.trim();
  if (v.note.trim()) search.note = v.note.trim();
  if (v.location) {
    search.lat = String(v.location.latitude);
    search.lng = String(v.location.longitude);
    if (v.location.accuracy_m != null) search.acc = String(v.location.accuracy_m);
    if (v.location.label) search.place = v.location.label;
    search.loc_source = v.location.source;
  }
  return search;
}

// ───────── The saver ─────────

const DEBOUNCE_MS = 800;

/** Columns waiting to be written, per row. */
const queued = new Map<string, Record<string, unknown>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Writes in flight, per row, so a flush can wait for them. */
const inflight = new Map<string, Promise<void>>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
let client: QueryClient | null = null;

function emit() {
  for (const l of listeners) l();
}

function setError(id: string, msg: string | null) {
  if (msg == null ? !errors.has(id) : errors.get(id) === msg) return;
  if (msg == null) errors.delete(id);
  else errors.set(id, msg);
  emit();
}

/** Patch the row in every cached /pending list, so both views read the edit. */
function patchCache(id: string, cols: Record<string, unknown>) {
  // The same key prefix also holds the nav badge's count, which is no list.
  client?.setQueriesData<unknown>({ queryKey: ["pending_transactions"] }, (old: unknown) =>
    Array.isArray(old)
      ? (old as PendingTransaction[]).map((r) =>
          r.id === id ? ({ ...r, ...cols } as PendingTransaction) : r,
        )
      : old,
  );
}

async function write(id: string): Promise<void> {
  const prev = inflight.get(id);
  if (prev) await prev;
  const cols = queued.get(id);
  queued.delete(id);
  if (!cols || Object.keys(cols).length === 0) return;
  const run = (async () => {
    const { error } = await supabase
      .from("pending_transactions")
      .update(cols as never)
      .eq("id", id)
      .eq("status", "pending");
    // A failed write stays queued under anything typed since, so the next
    // edit (or the next flush) tries it again.
    if (error) {
      queued.set(id, { ...cols, ...(queued.get(id) ?? {}) });
      setError(id, error.message);
    } else {
      setError(id, null);
    }
  })();
  inflight.set(id, run);
  try {
    await run;
  } finally {
    if (inflight.get(id) === run) inflight.delete(id);
  }
}

/**
 * Save changed values of one row: into the cache now, into the database after
 * the pause, or straight away with `immediate`.
 */
export function savePendingValues(
  qc: QueryClient,
  id: string,
  values: Partial<PendingValues>,
  opts: { immediate?: boolean } = {},
): void {
  client = qc;
  const cols = valuesToColumns(values);
  if (Object.keys(cols).length === 0 && !opts.immediate) return;
  patchCache(id, cols);
  queued.set(id, { ...(queued.get(id) ?? {}), ...cols });
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (opts.immediate) void write(id);
  else
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void write(id);
      }, DEBOUNCE_MS),
    );
}

/** Write whatever is waiting for one row (or all rows) now, and wait for it. */
export async function flushPendingSaves(id?: string): Promise<void> {
  const ids = id ? [id] : [...new Set([...queued.keys(), ...inflight.keys()])];
  await Promise.all(
    ids.map((x) => {
      const t = timers.get(x);
      if (t) clearTimeout(t);
      timers.delete(x);
      return write(x);
    }),
  );
}

/** The last failed save of a row, until one succeeds. */
export function usePendingSaveError(id: string): string | null {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => errors.get(id) ?? null,
    () => null,
  );
}

// A closing or hidden tab gets what was typed in the last pause. Best effort:
// a browser that kills the page outright can still drop the final keystrokes.
if (typeof window !== "undefined") {
  const flush = () => void flushPendingSaves();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
