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

export type LocationHistoryEntry = TxLocation & {
  description: string | null;
  /**
   * Optional so the recent-places picker and the ingest lookup, which do not
   * need it, keep compiling. Proximity matching wants it: three pins stamped
   * the same day are one errand, not a habit.
   */
  occurred_on?: string | null;
};

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


// ---------------------------------------------------------------------------
// Proximity
// ---------------------------------------------------------------------------

/**
 * Naming a place from the fix alone, when the description says nothing.
 *
 * `suggestLocationLabel` above needs the description to match *and* the point
 * to be near. That conjunction is right when the terminal sent a merchant name,
 * and useless when it sent "Kartenzahlung" — which is most of the time. Yet a
 * fix at a till the user has stood at on three separate days is strong evidence
 * on its own, and it was being thrown away.
 *
 * So: cluster the places within the radius, and answer only when they agree.
 */

/** Below this a place is a coincidence rather than a habit. */
const MIN_VISITS = 3;

/** Three pins stamped the same day are one errand. */
const MIN_DISTINCT_DAYS = 2;

/** How much of the traffic in radius the winner has to hold. */
const MIN_AGREEMENT = 0.6;

/**
 * Proximity alone never reaches the confidence that lets a suggestion apply
 * itself (see docs/pending-suggestions-feedback-loop.md). Being in the right
 * place is enough to offer a chip and never enough to write without a tap.
 */
const MAX_PROXIMITY_CONFIDENCE = 0.85;

export interface ProximityPlace {
  /** Copied verbatim out of one stored row — see `pickRepresentative`. */
  location: TxLocation;
  confidence: number;
  visits: number;
}

/**
 * Picks the one pin that speaks for a cluster.
 *
 * A curated pin outranks a device fix: dropping a marker is an assertion about
 * where a shop is, while a device fix is only where a phone happened to be.
 * Never an average — a centroid is a point nobody chose, carries no honest
 * `source`, and can land in the road between two shops.
 */
export function pickRepresentative(members: LocationHistoryEntry[]): TxLocation {
  const rank = (e: LocationHistoryEntry) => (e.source === "device" ? 1 : 0);
  const best = members
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const r = rank(a.entry) - rank(b.entry);
      if (r !== 0) return r;
      const day = (b.entry.occurred_on ?? "").localeCompare(a.entry.occurred_on ?? "");
      if (day !== 0) return day;
      const acc = (a.entry.accuracy_m ?? Infinity) - (b.entry.accuracy_m ?? Infinity);
      if (acc !== 0) return acc;
      return a.index - b.index;
    })[0].entry;
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    accuracy_m: best.accuracy_m,
    label: best.label,
    source: best.source,
  };
}

/** The places within the radius, grouped by the name the user gave them. */
function clustersNear(
  history: LocationHistoryEntry[],
  fix: { latitude: number; longitude: number; accuracy_m?: number | null },
): { groups: Map<string, LocationHistoryEntry[]>; total: number } {
  const radius = matchRadiusM(fix.accuracy_m);
  const groups = new Map<string, LocationHistoryEntry[]>();
  let total = 0;
  for (const entry of history) {
    if (haversineMeters(fix, entry) > radius) continue;
    total += 1;
    // Clustered by label, not by coordinates: the Coop and the Migros in one
    // station concourse are 20 m apart, and merging them by distance would
    // answer confidently with the wrong shop. A place with no name cannot be
    // suggested to anyone, so it only counts towards the total.
    const key = normalizeDescription(entry.label);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return { groups, total };
}

/**
 * The place a fix is at, when the user's own visits agree about it.
 *
 * Returns nothing when the evidence is thin (one visit, or several on one day)
 * or divided (two shops in radius visited about equally). Silence is the right
 * answer there: a wrong pin is worse than no pin, and the divided case is what
 * the notification text — read by the model — exists to break.
 */
export function suggestPlaceFromProximity(
  history: LocationHistoryEntry[],
  fix: { latitude: number; longitude: number; accuracy_m?: number | null },
): ProximityPlace | null {
  const { groups, total } = clustersNear(history, fix);
  if (groups.size === 0) return null;

  const ranked = [...groups.values()].sort(
    (a, b) =>
      b.length - a.length ||
      (b[0].occurred_on ?? "").localeCompare(a[0].occurred_on ?? ""),
  );
  const winner = ranked[0];

  const visits = winner.length;
  if (visits < MIN_VISITS) return null;
  const days = new Set(winner.map((e) => e.occurred_on ?? "")).size;
  if (days < MIN_DISTINCT_DAYS) return null;

  const agreement = visits / total;
  if (agreement < MIN_AGREEMENT) return null;

  const location = pickRepresentative(winner);
  const radius = matchRadiusM(fix.accuracy_m);
  const distance = haversineMeters(fix, location);
  // Being inside the radius at all is the claim; where inside is a refinement,
  // hence the floor rather than a score that decays to nothing at the edge.
  const proximity = Math.min(1, Math.max(0.4, 1 - distance / radius));
  const attestation = visits >= 5 ? 1 : visits === 4 ? 0.9 : 0.8;
  const confidence = Math.min(
    MAX_PROXIMITY_CONFIDENCE,
    round3(proximity * agreement * attestation),
  );

  return { location, confidence, visits };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
