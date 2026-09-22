import { describe, expect, it } from "vitest";

import {
  descriptionsMatch,
  haversineMeters,
  matchRadiusM,
  normalizeDescription,
  buildPlaceTable,
  pickRepresentative,
  rankLocationCandidates,
  refsNear,
  renderPlaceTable,
  suggestLocationLabel,
  suggestPlaceFromProximity,
  type LocationHistoryEntry,
} from "@/lib/locationSuggest";

function entry(
  partial: Partial<LocationHistoryEntry> & { latitude: number; longitude: number },
): LocationHistoryEntry {
  return {
    accuracy_m: null,
    label: null,
    source: "manual",
    description: null,
    ...partial,
  };
}

// Two Coop branches in Lucerne, ~1.2 km apart, plus the till the phone stood at.
const coopBahnhof = entry({
  latitude: 47.050_2,
  longitude: 8.310_3,
  label: "Coop Bahnhof, Luzern",
  description: "Coop Luzern",
});
const coopTribschen = entry({
  latitude: 47.041_0,
  longitude: 8.318_0,
  label: "Coop Tribschen, Luzern",
  description: "Coop Luzern",
});
const migros = entry({
  latitude: 47.050_5,
  longitude: 8.310_1,
  label: "Migros Bahnhof",
  description: "Migros",
});
const atBahnhof = { latitude: 47.050_25, longitude: 8.310_4, accuracy_m: 40 };

describe("haversineMeters", () => {
  it("measures a short city distance", () => {
    const d = haversineMeters({ latitude: 47.0502, longitude: 8.3103 }, coopTribschen);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1400);
  });

  it("is zero for the same point", () => {
    expect(haversineMeters(coopBahnhof, coopBahnhof)).toBe(0);
  });
});

describe("normalizeDescription", () => {
  it("strips case, accents and punctuation", () => {
    expect(normalizeDescription("Café  Müller-Bar!")).toBe("cafe muller bar");
  });
});

describe("descriptionsMatch", () => {
  it("matches a branch against its chain", () => {
    expect(descriptionsMatch("Coop", "Coop Luzern Bahnhof")).toBe(true);
  });

  it("ignores anything too short to mean something", () => {
    expect(descriptionsMatch("A", "A")).toBe(false);
  });

  it("does not match unrelated merchants", () => {
    expect(descriptionsMatch("Coop Luzern", "Migros")).toBe(false);
  });
});

describe("rankLocationCandidates", () => {
  it("puts the matching description first, nearest of those first", () => {
    const ranked = rankLocationCandidates([coopTribschen, migros, coopBahnhof], {
      description: "Coop Luzern",
      near: atBahnhof,
    });
    expect(ranked.map((c) => c.label)).toEqual([
      "Coop Bahnhof, Luzern",
      "Coop Tribschen, Luzern",
      "Migros Bahnhof",
    ]);
    expect(ranked[0].matchesDescription).toBe(true);
    expect(ranked[2].matchesDescription).toBe(false);
  });

  it("still ranks the non-matching entries by distance", () => {
    const far = entry({ latitude: 47.38, longitude: 8.54, label: "Zürich HB" });
    const ranked = rankLocationCandidates([far, migros], { description: "Coop", near: atBahnhof });
    expect(ranked.map((c) => c.label)).toEqual(["Migros Bahnhof", "Zürich HB"]);
  });

  it("keeps the given order when there is nothing to rank by", () => {
    const ranked = rankLocationCandidates([coopTribschen, coopBahnhof], {});
    expect(ranked.map((c) => c.label)).toEqual(["Coop Tribschen, Luzern", "Coop Bahnhof, Luzern"]);
    expect(ranked[0].distance_m).toBeNull();
  });

  it("reports the distance it ranked by", () => {
    const [first] = rankLocationCandidates([coopBahnhof], { near: atBahnhof });
    expect(first.distance_m).toBeLessThan(20);
  });

  it("honours the limit", () => {
    expect(rankLocationCandidates([coopBahnhof, coopTribschen, migros], { limit: 2 })).toHaveLength(
      2,
    );
  });
});

describe("matchRadiusM", () => {
  it("never trusts a fix tighter than the floor", () => {
    expect(matchRadiusM(5)).toBe(150);
    expect(matchRadiusM(null)).toBe(150);
  });

  it("widens with a coarse fix but stops at the ceiling", () => {
    expect(matchRadiusM(300)).toBe(300);
    expect(matchRadiusM(5000)).toBe(500);
  });
});

describe("suggestLocationLabel", () => {
  it("names the branch the phone was actually standing in", () => {
    expect(suggestLocationLabel([coopTribschen, coopBahnhof], atBahnhof, "Coop Luzern")).toBe(
      "Coop Bahnhof, Luzern",
    );
  });

  it("says nothing when the only match is a different branch", () => {
    expect(suggestLocationLabel([coopTribschen], atBahnhof, "Coop Luzern")).toBeNull();
  });

  it("does not borrow a name from a nearby but unrelated shop", () => {
    expect(suggestLocationLabel([migros], atBahnhof, "Coop Luzern")).toBeNull();
  });

  it("skips a matching entry that has no label to lend", () => {
    const unlabelled = entry({ latitude: 47.0502, longitude: 8.3103, description: "Coop Luzern" });
    expect(suggestLocationLabel([unlabelled], atBahnhof, "Coop Luzern")).toBeNull();
  });

  it("widens the radius when the fix admits it is coarse", () => {
    // ~340 m from the Tribschen branch: outside the 150 m floor, inside a 400 m fix.
    const coarse = { latitude: 47.044_0, longitude: 8.317_0, accuracy_m: 400 };
    expect(suggestLocationLabel([coopTribschen], coarse, "Coop Luzern")).toBe(
      "Coop Tribschen, Luzern",
    );
  });
});


/** The same branch, visited on distinct days — what a habit looks like. */
function visits(base: LocationHistoryEntry, days: string[]): LocationHistoryEntry[] {
  return days.map((occurred_on) => ({ ...base, occurred_on }));
}

const THREE_DAYS = ["2026-09-01", "2026-09-08", "2026-09-15"];

describe("suggestPlaceFromProximity", () => {
  it("names the place past visits agree on, with no description match at all", () => {
    // The headline case: the terminal sent "Kartenzahlung", so the conjunctive
    // path in suggestLocationLabel has nothing to match and stays silent.
    const history = visits(coopBahnhof, THREE_DAYS);
    expect(suggestLocationLabel(history, atBahnhof, "Kartenzahlung")).toBeNull();
    expect(suggestPlaceFromProximity(history, atBahnhof)?.location.label).toBe(
      "Coop Bahnhof, Luzern",
    );
  });

  it("refuses a single visit", () => {
    expect(suggestPlaceFromProximity([{ ...coopBahnhof, occurred_on: "2026-09-01" }], atBahnhof))
      .toBeNull();
  });

  it("refuses two visits on two days — near, but not yet a habit", () => {
    // Isolates the visit count from the distinct-day rule: this passes the day
    // guard, so only MIN_VISITS can turn it down.
    const twice = visits(coopBahnhof, ["2026-09-01", "2026-09-08"]);
    expect(suggestPlaceFromProximity(twice, atBahnhof)).toBeNull();
  });

  it("refuses three visits stamped the same day", () => {
    // One afternoon errand, not a pattern — the case a bare count >= 3 misses.
    const sameDay = visits(coopBahnhof, ["2026-09-01", "2026-09-01", "2026-09-01"]);
    expect(suggestPlaceFromProximity(sameDay, atBahnhof)).toBeNull();
  });

  it("says nothing when two nearby places are visited about equally", () => {
    // Proximity genuinely does not know which shop it was. Silence here is what
    // leaves room for the notification text to break the tie.
    const history = [...visits(coopBahnhof, THREE_DAYS), ...visits(migros, THREE_DAYS)];
    expect(suggestPlaceFromProximity(history, atBahnhof)).toBeNull();
  });

  it("answers once one of two nearby places clearly dominates", () => {
    const history = [
      ...visits(coopBahnhof, ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"]),
      { ...migros, occurred_on: "2026-09-02" },
    ];
    expect(suggestPlaceFromProximity(history, atBahnhof)?.location.label).toBe(
      "Coop Bahnhof, Luzern",
    );
  });

  it("ignores places outside the radius the fix admits to", () => {
    const far = visits(coopTribschen, THREE_DAYS);
    expect(suggestPlaceFromProximity(far, atBahnhof)).toBeNull();
    // And a wildly optimistic accuracy must not buy a bigger radius: matchRadiusM
    // caps at 500 m, and Tribschen is 1.2 km away.
    expect(suggestPlaceFromProximity(far, { ...atBahnhof, accuracy_m: 5000 })).toBeNull();
  });

  it("returns a stored pin verbatim, never an average of them", () => {
    const history = [
      // Deliberately chosen so their mean is not one of them — otherwise a
      // centroid would coincide with an input and the assertion would pass
      // against exactly the implementation it exists to reject.
      { ...coopBahnhof, occurred_on: "2026-09-01", latitude: 47.050_1 },
      { ...coopBahnhof, occurred_on: "2026-09-08", latitude: 47.050_2 },
      { ...coopBahnhof, occurred_on: "2026-09-15", latitude: 47.050_7 },
    ];
    const got = suggestPlaceFromProximity(history, atBahnhof)!.location;
    const inputs = history.map((h) => ({
      latitude: h.latitude,
      longitude: h.longitude,
      accuracy_m: h.accuracy_m,
      label: h.label,
      source: h.source,
    }));
    expect(inputs).toContainEqual(got);
  });

  it("treats differently punctuated spellings of one name as one place", () => {
    const history = [
      { ...coopBahnhof, occurred_on: "2026-09-01", label: "Coop Bahnhof, Luzern" },
      { ...coopBahnhof, occurred_on: "2026-09-08", label: "Coop Bahnhof Luzern" },
      { ...coopBahnhof, occurred_on: "2026-09-15", label: "COOP  Bahnhof, Luzern" },
    ];
    expect(suggestPlaceFromProximity(history, atBahnhof)?.visits).toBe(3);
  });

  it("ignores nearby points nobody ever named", () => {
    const unnamed = visits({ ...coopBahnhof, label: null }, THREE_DAYS);
    expect(suggestPlaceFromProximity(unnamed, atBahnhof)).toBeNull();
  });

  it("never reaches the confidence that would let a suggestion apply itself", () => {
    // docs/pending-suggestions-feedback-loop.md gates auto-apply at 0.9. A
    // place known only by where the phone was must stay a chip, however many
    // times the user has been there.
    const many = visits(coopBahnhof, [
      "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
      "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
    const c = suggestPlaceFromProximity(many, { ...coopBahnhof, accuracy_m: 40 })!.confidence;
    expect(c).toBeLessThan(0.9);
  });

  it("is more confident about more visits", () => {
    const three = suggestPlaceFromProximity(visits(coopBahnhof, THREE_DAYS), atBahnhof)!;
    const five = suggestPlaceFromProximity(
      visits(coopBahnhof, [...THREE_DAYS, "2026-09-22", "2026-09-29"]),
      atBahnhof,
    )!;
    expect(five.confidence).toBeGreaterThan(three.confidence);
  });

  it("uses the same radius clamp the label path does", () => {
    const at = { latitude: 47.050_2, longitude: 8.310_3, accuracy_m: 5000 };
    const inside = { ...coopBahnhof, latitude: 47.054_5 }; // ~480 m north
    const outside = { ...coopBahnhof, latitude: 47.054_9 }; // ~520 m north
    expect(haversineMeters(at, inside)).toBeLessThan(matchRadiusM(5000));
    expect(haversineMeters(at, outside)).toBeGreaterThan(matchRadiusM(5000));
    expect(suggestPlaceFromProximity(visits(inside, THREE_DAYS), at)).not.toBeNull();
    expect(suggestPlaceFromProximity(visits(outside, THREE_DAYS), at)).toBeNull();
  });
});

describe("pickRepresentative", () => {
  it("prefers a pin the user placed over one a phone measured", () => {
    const members: LocationHistoryEntry[] = [
      { ...coopBahnhof, occurred_on: "2026-09-15", source: "device", accuracy_m: 30 },
      { ...coopBahnhof, occurred_on: "2026-08-01", source: "search", latitude: 47.050_9 },
    ];
    expect(pickRepresentative(members).source).toBe("search");
  });

  it("prefers the most recent among equally curated pins", () => {
    const members: LocationHistoryEntry[] = [
      { ...coopBahnhof, occurred_on: "2026-08-01", latitude: 47.050_9 },
      { ...coopBahnhof, occurred_on: "2026-09-15", latitude: 47.050_2 },
    ];
    expect(pickRepresentative(members).latitude).toBe(47.050_2);
  });

  it("prefers the tighter fix when the pins are equally recent and curated", () => {
    const members: LocationHistoryEntry[] = [
      { ...coopBahnhof, occurred_on: "2026-09-15", accuracy_m: 120, latitude: 47.050_9 },
      { ...coopBahnhof, occurred_on: "2026-09-15", accuracy_m: 10, latitude: 47.050_2 },
    ];
    expect(pickRepresentative(members).latitude).toBe(47.050_2);
  });
});


describe("buildPlaceTable", () => {
  it("gives one ref per place, not one per visit", () => {
    const table = buildPlaceTable([
      ...visits(coopBahnhof, THREE_DAYS),
      ...visits(migros, ["2026-09-02", "2026-09-09"]),
    ]);
    expect(table.map((p) => [p.location.label, p.visits])).toEqual([
      ["Coop Bahnhof, Luzern", 3],
      ["Migros Bahnhof", 2],
    ]);
  });

  it("keeps two shops at the same address apart", () => {
    // Coop and Migros share a station concourse, ~25 m apart. Clustering by
    // coordinates would merge them and offer the model one ref where the whole
    // point is that it has to choose between two.
    expect(haversineMeters(coopBahnhof, migros)).toBeLessThan(40);
    const table = buildPlaceTable([...visits(coopBahnhof, THREE_DAYS), ...visits(migros, THREE_DAYS)]);
    expect(table).toHaveLength(2);
  });

  it("treats differently punctuated spellings as one place", () => {
    const table = buildPlaceTable([
      { ...coopBahnhof, occurred_on: "2026-09-01", label: "Coop Bahnhof, Luzern" },
      { ...coopBahnhof, occurred_on: "2026-09-08", label: "COOP Bahnhof Luzern" },
    ]);
    expect(table).toHaveLength(1);
    expect(table[0].visits).toBe(2);
  });

  it("drops points nobody ever named — a ref needs something to call it", () => {
    expect(buildPlaceTable(visits({ ...coopBahnhof, label: null }, THREE_DAYS))).toEqual([]);
  });

  it("caps the table, keeping the places the user goes to most", () => {
    const many: LocationHistoryEntry[] = [];
    for (let i = 0; i < 40; i++) {
      many.push(
        ...visits(
          { ...coopBahnhof, latitude: 47 + i / 1000, label: `Shop ${i}` },
          i === 39 ? THREE_DAYS : ["2026-09-01"],
        ),
      );
    }
    const table = buildPlaceTable(many);
    expect(table).toHaveLength(24);
    expect(table[0].location.label).toBe("Shop 39");
  });

  it("numbers refs from p1 without gaps", () => {
    const table = buildPlaceTable([...visits(coopBahnhof, THREE_DAYS), ...visits(migros, ["2026-09-02"])]);
    expect(table.map((p) => p.ref)).toEqual(["p1", "p2"]);
  });
});

describe("renderPlaceTable", () => {
  it("never puts a coordinate in the block the model sees", () => {
    // The app's standing claim is that pending_enrich sends place *names* and
    // never coordinates. This makes that mechanical rather than a promise: it
    // fails if anyone prints a latitude, or re-adds the distances that an
    // earlier draft of the prompt carried.
    const block = renderPlaceTable(buildPlaceTable(visits(coopBahnhof, THREE_DAYS)));
    expect(block).not.toMatch(/\d+\.\d{4,}/);
    expect(block).toContain("Coop Bahnhof, Luzern");
  });
});

describe("refsNear", () => {
  it("offers only the places within reach of the fix, nearest first", () => {
    const table = buildPlaceTable([
      ...visits(coopTribschen, THREE_DAYS),
      ...visits(migros, THREE_DAYS),
      ...visits(coopBahnhof, THREE_DAYS),
    ]);
    const byRef = new Map(table.map((p) => [p.ref, p.location.label]));
    const near = refsNear(table, atBahnhof).map((r) => byRef.get(r));
    expect(near).toEqual(["Coop Bahnhof, Luzern", "Migros Bahnhof"]);
  });

  it("offers nothing at a place the user has never been", () => {
    const table = buildPlaceTable(visits(coopBahnhof, THREE_DAYS));
    expect(refsNear(table, { latitude: 46.2, longitude: 6.14, accuracy_m: 40 })).toEqual([]);
  });

  it("does not let an optimistic accuracy widen the net", () => {
    const table = buildPlaceTable(visits(coopTribschen, THREE_DAYS));
    expect(refsNear(table, { ...atBahnhof, accuracy_m: 5000 })).toEqual([]);
  });
});
