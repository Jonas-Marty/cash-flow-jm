import { describe, expect, it } from "vitest";

import {
  descriptionsMatch,
  haversineMeters,
  matchRadiusM,
  normalizeDescription,
  rankLocationCandidates,
  suggestLocationLabel,
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
