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

import { normalizeDescription } from "./locationSuggest";

export interface HistoryTx {
  description: string | null;
  category_id: string | null;
  type: string;
  occurred_on: string;
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

  // Nothing new to say: same wording, no category to offer.
  if (!winner && normalizeDescription(description) === rowKey) return null;

  return {
    description,
    category_id: winner,
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
  tags: string[];
  confidence: number;
}

const MAX_TAGS = 3;
const MAX_DESCRIPTION_CHARS = 120;

/**
 * Turns whatever the model returned into suggestions that are safe to store.
 * Unknown row ids and category ids are dropped, tags are normalised, and a
 * suggestion left with nothing is not returned at all.
 */
export function parseModelSuggestions(
  json: unknown,
  rowIds: Set<string>,
  validCategoryIds: Set<string>,
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
    const c =
      typeof s?.confidence === "number" && Number.isFinite(s.confidence) ? s.confidence : 0.5;
    const confidence = round3(Math.min(1, Math.max(0, c)));

    if (!description && !category_id && tags.length === 0) continue;
    out.set(id, { description, category_id, tags, confidence });
  }
  return out;
}
