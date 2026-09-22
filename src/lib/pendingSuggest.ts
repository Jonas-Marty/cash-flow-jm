/**
 * Suggestions for pending transactions that arrived without a category.
 *
 * Two sources, tried in this order:
 *
 *   1. History — the user's own past transactions. A notification for a
 *      merchant they have paid before should get the category they used then,
 *      with no model in the loop. Pure, cheap, and works with AI switched off.
 *   2. The model — for rows history cannot place. Its answer is validated
 *      here before anything is stored: unknown category ids are dropped, and
 *      a row with nothing left after validation gets no suggestion at all.
 *
 * Everything in this file is pure so it can be unit-tested; the server pass
 * in utils/pending.enrich.server.ts does the reading and writing.
 */

import {
  normalizeDescription,
  suggestPlaceFromProximity,
  type LocationHistoryEntry,
} from "./locationSuggest";
import { locationFromRow, type TxLocation } from "./location";

export interface HistoryTx {
  description: string | null;
  category_id: string | null;
  type: string;
  occurred_on: string;
  note?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_accuracy_m?: number | string | null;
  location_label?: string | null;
  location_source?: string | null;
}

export interface PendingLike {
  description: string | null;
  external_info: string | null;
  location_label: string | null;
  type: string;
}

export interface HistorySuggestion {
  /** The description as the user last wrote it for this merchant. */
  description: string;
  category_id: string | null;
  /** The note the user last wrote for this merchant, if any. */
  note: string | null;
  /**
   * Where they were the last time. A whole location rather than a name:
   * only a stored transaction can supply the coordinates `TxLocation`
   * needs, which is why the model is never asked for one.
   */
  location: TxLocation | null;
  /** 0..1, see `confidence()` for how it is composed. */
  confidence: number;
  /** How many past transactions backed this. */
  matches: number;
}

/** Below this the suggestion is not worth showing. */
export const MIN_HISTORY_CONFIDENCE = 0.5;

/** A past description shorter than this matches too many things. */
const MIN_KEY_CHARS = 3;
/** Containment in the raw notification text needs a little more to be safe. */
const MIN_CONTAINED_KEY_CHARS = 4;

const EXACT_WEIGHT = 1.0;
const CONTAINED_WEIGHT = 0.8;

/**
 * Picks the category and description the user gave the last time this
 * merchant showed up.
 *
 * The row's own description is matched exactly; the raw notification text
 * (and the place name, when the API borrowed one) is searched for past
 * descriptions as whole words — "Coop" must not light up on "cooperative".
 */
export function suggestFromHistory(
  row: PendingLike,
  history: HistoryTx[],
): HistorySuggestion | null {
  if (row.type === "transfer") return null;

  const rowKey = normalizeDescription(row.description ?? "");
  const haystack = ` ${normalizeDescription(
    [row.description, row.location_label, row.external_info].filter(Boolean).join(" "),
  )} `;

  type Group = {
    key: string;
    weight: number;
    count: number;
    latest: HistoryTx;
    cats: Map<string, number>;
    uncategorised: number;
  };
  const groups = new Map<string, Group>();

  for (const tx of history) {
    if (tx.type !== row.type) continue;
    const key = normalizeDescription(tx.description ?? "");
    if (key.length < MIN_KEY_CHARS) continue;

    let weight = 0;
    if (rowKey && key === rowKey) weight = EXACT_WEIGHT;
    else if (key.length >= MIN_CONTAINED_KEY_CHARS && haystack.includes(` ${key} `))
      weight = CONTAINED_WEIGHT;
    if (weight === 0) continue;

    const g = groups.get(key) ?? {
      key,
      weight,
      count: 0,
      latest: tx,
      cats: new Map<string, number>(),
      uncategorised: 0,
    };
    g.count += 1;
    g.weight = Math.max(g.weight, weight);
    if (tx.occurred_on > g.latest.occurred_on) g.latest = tx;
    if (tx.category_id) g.cats.set(tx.category_id, (g.cats.get(tx.category_id) ?? 0) + 1);
    else g.uncategorised += 1;
    groups.set(key, g);
  }
  if (groups.size === 0) return null;

  // Prefer the strongest match, then the better-attested one, then the more
  // specific description ("coop pronto" over "coop").
  const best = [...groups.values()].sort(
    (a, b) => b.weight - a.weight || b.count - a.count || b.key.length - a.key.length,
  )[0];

  const [winner, votes] = [...best.cats.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const description = (best.latest.description ?? "").trim();
  const note = (best.latest.note ?? "").trim() || null;
  const location = locationFromRow(best.latest);

  // Nothing new to say: same wording, and no category, note or place to offer.
  if (!winner && !note && !location && normalizeDescription(description) === rowKey) return null;

  return {
    description,
    category_id: winner,
    note,
    location,
    confidence: confidence(best.weight, votes, best.count),
    matches: best.count,
  };
}

/**
 * Exact match beats containment; agreement between past entries beats a
 * single one. One exact hit scores 0.75, three agreeing exact hits 1.0, one
 * containment hit 0.6. Category disagreement pulls it down proportionally.
 */
function confidence(weight: number, votes: number, count: number): number {
  const agreement = count === 0 ? 0 : votes === 0 ? 1 : votes / count;
  const attestation = count >= 3 ? 1 : count === 2 ? 0.9 : 0.75;
  return round3(weight * agreement * attestation);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

export interface ModelSuggestion {
  description: string | null;
  category_id: string | null;
  /** The remark the model would have written. */
  note: string | null;
  tags: string[];
  /**
   * Which of the places offered to *this row* the model picked, or null. A
   * reference into a table the server built and still holds — never a name,
   * and never a coordinate. The model cannot introduce a place; it can only
   * choose among the ones geometry already judged plausible.
   */
  place_ref: string | null;
  confidence: number;
}

const MAX_TAGS = 3;
const MAX_DESCRIPTION_CHARS = 120;
const MAX_NOTE_CHARS = 300;

/**
 * Turns whatever the model returned into suggestions that are safe to store.
 * Unknown row ids and category ids are dropped, tags are normalised, and a
 * suggestion left with nothing is not returned at all.
 */
export function parseModelSuggestions(
  json: unknown,
  rowIds: Set<string>,
  validCategoryIds: Set<string>,
  /**
   * Per row, not global. A row with no fix has no entry, so the model cannot
   * place it at all — "Coop" in a notification does not say *which* Coop, and
   * a location with the wrong coordinates is worse than none. Optional so the
   * default is the safe one: absent means no row may claim a place.
   */
  allowedPlaceRefs?: Map<string, Set<string>>,
): Map<string, ModelSuggestion> {
  const out = new Map<string, ModelSuggestion>();
  const list = (json as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list)) return out;

  for (const raw of list as unknown[]) {
    const s = raw as Record<string, unknown> | null;
    const id = typeof s?.pending_id === "string" ? s.pending_id : null;
    if (!id || !rowIds.has(id) || out.has(id)) continue;

    const description =
      typeof s?.description === "string" && s.description.trim()
        ? s.description.trim().slice(0, MAX_DESCRIPTION_CHARS)
        : null;
    const category_id =
      typeof s?.category_id === "string" && validCategoryIds.has(s.category_id)
        ? s.category_id
        : null;
    const note =
      typeof s?.note === "string" && s.note.trim() ? s.note.trim().slice(0, MAX_NOTE_CHARS) : null;
    const tags = Array.isArray(s?.tags)
      ? [
          ...new Set(
            (s.tags as unknown[])
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.replace(/^#/, "").trim().toLowerCase())
              .filter((t) => t.length > 0 && /^[\p{L}\p{N}_-]+$/u.test(t)),
          ),
        ].slice(0, MAX_TAGS)
      : [];
    const allowed = allowedPlaceRefs?.get(id);
    const place_ref =
      typeof s?.place_ref === "string" && allowed?.has(s.place_ref) ? s.place_ref : null;
    const c =
      typeof s?.confidence === "number" && Number.isFinite(s.confidence) ? s.confidence : 0.5;
    const confidence = round3(Math.min(1, Math.max(0, c)));

    // A place on its own is a whole answer — telling two shops in one concourse
    // apart is the only thing the model is asked about places at all.
    if (!description && !category_id && !note && tags.length === 0 && !place_ref) continue;
    out.set(id, { description, category_id, note, tags, place_ref, confidence });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Place, from where the row was captured
// ---------------------------------------------------------------------------

/** A pending row that may have brought coordinates with it. */
export interface LocatedRow {
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_accuracy_m?: number | string | null;
}

/**
 * The place a row was captured at, judged only by the fix it arrived with.
 *
 * Deliberately separate from `suggestFromHistory`, which finds a place by
 * matching the *description*. That is the stronger claim and wins when it is
 * available — but its confidence gates the whole row, so folding a place score
 * into it would let a good place promote a bad category. Keeping them apart
 * also means a row whose category came from the model can still get its place
 * from geometry, which is the common shape for a generic bank notification.
 */
export function suggestPlaceForRow(
  row: LocatedRow,
  located: LocationHistoryEntry[],
): { location: TxLocation; confidence: number } | null {
  const lat = row.latitude == null ? null : Number(row.latitude);
  const lng = row.longitude == null ? null : Number(row.longitude);
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const acc = row.location_accuracy_m == null ? null : Number(row.location_accuracy_m);
  const hit = suggestPlaceFromProximity(located, {
    latitude: lat,
    longitude: lng,
    accuracy_m: acc != null && Number.isFinite(acc) ? acc : null,
  });
  return hit ? { location: hit.location, confidence: hit.confidence } : null;
}

/** The located transactions among a history, in the shape proximity wants. */
export function locatedHistory(history: HistoryTx[]): LocationHistoryEntry[] {
  const out: LocationHistoryEntry[] = [];
  for (const tx of history) {
    const loc = locationFromRow(tx);
    if (loc) out.push({ ...loc, description: tx.description ?? null, occurred_on: tx.occurred_on });
  }
  return out;
}
