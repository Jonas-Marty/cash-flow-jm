/**
 * Turning a coarse device fix into a place the user recognises.
 *
 * A phone at a till usually answers with WiFi and cell towers — tens of metres
 * on a good day. That is nowhere near enough to name a shop, but it is plenty
 * to pick the right branch out of the places the user has already visited and
 * labelled by hand. So: match on the description, rank by distance to the fix,
 * and let the fix act as the tie-breaker rather than as the answer.
 *
 * Browser-safe and dependency-free: the public API route and the /pending view
 * both use it.
 */

import type { TxLocation } from "@/lib/location";

export type LocationHistoryEntry = TxLocation & { description: string | null };

export type LocationCandidate = LocationHistoryEntry & {
  /** Metres from the reference point, or null when there is none. */
  distance_m: number | null;
  matchesDescription: boolean;
};

/** Below this a fix is treated as if it were this coarse — GPS lies optimistically. */
const MIN_RADIUS_M = 150;

/** However coarse the fix, a place this far away is a different errand. */
const MAX_RADIUS_M = 500;

const EARTH_RADIUS_M = 6_371_008.8;

export function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Descriptions arrive from a notification regex, so they carry whatever the
 * payment terminal felt like sending: casing, accents, punctuation, a branch
 * number. Compare on letters and digits only.
 */
export function normalizeDescription(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Deliberately loose: "Coop" should match "Coop Luzern Bahnhof", because the
 * distance check is what decides which Coop it was. Too short to be meaningful
 * on its own ("SBB" is fine, "A" is not) never matches.
 */
export function descriptionsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizeDescription(a);
  const right = normalizeDescription(b);
  if (left.length < 3 || right.length < 3) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/** How far a match may be from the fix before it stops being the same errand. */
export function matchRadiusM(accuracyM: number | null | undefined): number {
  const accuracy = accuracyM != null && Number.isFinite(accuracyM) ? accuracyM : 0;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, accuracy));
}

/**
 * Orders known places for a transaction: same description first, then nearest
 * to the fix. Entries keep their input order (most recent first) when there is
 * nothing to rank them by, so the list is never worse than "recently used".
 */
export function rankLocationCandidates(
  history: LocationHistoryEntry[],
  options: {
    description?: string | null;
    near?: { latitude: number; longitude: number } | null;
    limit?: number;
  } = {},
): LocationCandidate[] {
  const { description = null, near = null, limit } = options;
  const candidates = history.map((entry, index) => ({
    ...entry,
    distance_m: near ? Math.round(haversineMeters(near, entry)) : null,
    matchesDescription:
      descriptionsMatch(description, entry.description) ||
      descriptionsMatch(description, entry.label),
    index,
  }));

  candidates.sort((a, b) => {
    if (a.matchesDescription !== b.matchesDescription) return a.matchesDescription ? -1 : 1;
    if (a.distance_m != null && b.distance_m != null && a.distance_m !== b.distance_m) {
      return a.distance_m - b.distance_m;
    }
    return a.index - b.index;
  });

  const ranked = candidates.map(({ index: _index, ...rest }) => rest);
  return limit == null ? ranked : ranked.slice(0, limit);
}

/**
 * The label to pre-fill on a row that arrived with a fix but no name.
 *
 * Only the name is borrowed, never the coordinates: what the phone measured is
 * evidence, and a curated pin from an earlier visit is not. The user promotes
 * the pin itself with one tap in /pending if they want it.
 */
export function suggestLocationLabel(
  history: LocationHistoryEntry[],
  fix: { latitude: number; longitude: number; accuracy_m?: number | null },
  description: string | null | undefined,
): string | null {
  const radius = matchRadiusM(fix.accuracy_m);
  const best = rankLocationCandidates(history, { description, near: fix })
    .filter((c) => c.matchesDescription && c.distance_m != null && c.distance_m <= radius)
    .find((c) => (c.label ?? "").trim().length > 0);
  return best?.label?.trim() ?? null;
}
