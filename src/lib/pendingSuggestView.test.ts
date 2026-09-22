import { describe, it, expect } from "vitest";
import {
  hasSuggestion,
  suggestsPlace,
  withSuggestion,
  type SuggestedRow,
  type SuggestionDraft,
} from "./pendingSuggestView";
import { locationFromRow, type TxLocation } from "./location";

/** The pin the user curated on an earlier visit — what a suggestion offers. */
const curated: TxLocation = {
  latitude: 47.050123,
  longitude: 8.309456,
  accuracy_m: null,
  label: "Coop Bahnhof, Luzern",
  source: "search",
};

/** What a phone actually measured: near, coarse, and nameless. */
const rawFix = {
  latitude: 47.050201,
  longitude: 8.309502,
  location_accuracy_m: 45,
  location_label: null,
  location_source: "device",
};

function row(over: Partial<SuggestedRow> = {}): SuggestedRow {
  return {
    type: "expense",
    suggested_category_id: null,
    suggested_description: null,
    suggested_note: null,
    suggested_location: curated,
    suggested_tags: [],
    latitude: null,
    longitude: null,
    location_accuracy_m: null,
    location_label: null,
    location_source: null,
    ...over,
  };
}

function draft(over: Partial<SuggestionDraft> = {}): SuggestionDraft {
  return { category_id: "", description: "", note: "", location: null, ...over };
}

describe("suggestsPlace", () => {
  it("offers the curated pin to a row that arrived with a raw device fix", () => {
    // The regression this module exists for. The draft is seeded from the row's
    // own coordinates, so a row with a fix always has `d.location` — and the old
    // `!d.location` guard made the chip unreachable for precisely the rows a
    // place suggestion is for. Nothing in production ever carried a fix, so it
    // never showed up.
    const p = row(rawFix);
    const d = draft({ location: locationFromRow(p) });
    expect(suggestsPlace(p, d)).toBe(true);
  });

  it("still offers when the row arrived with no location at all", () => {
    expect(suggestsPlace(row(), draft())).toBe(true);
  });

  it("stops offering once the user has moved the pin themselves", () => {
    const p = row(rawFix);
    const moved: TxLocation = { ...curated, latitude: 47.06, label: "Somewhere else" };
    expect(suggestsPlace(p, draft({ location: moved }))).toBe(false);
  });

  it("stops offering once the suggestion has been taken", () => {
    const p = row(rawFix);
    expect(suggestsPlace(p, draft({ location: curated }))).toBe(false);
  });

  it("does not offer a pin the draft already holds", () => {
    // Degenerate but reachable: the proximity match can land on a pin the user
    // saved at exactly this point, so the suggestion equals the row's own fix.
    // Without the second half of the guard the chip offers a change that would
    // change nothing, and re-offers it after every tap.
    const same = { ...rawFix, location_label: curated.label, location_source: "search" };
    const p = row({ ...same, suggested_location: locationFromRow(same)! });
    const d = draft({ location: locationFromRow(same) });
    expect(suggestsPlace(p, d)).toBe(false);
  });

  it("offers nothing when there is nothing to offer", () => {
    expect(suggestsPlace(row({ suggested_location: null }), draft())).toBe(false);
  });

  it("survives the round trip through the database, which rounds to 6 dp", () => {
    // A draft seeded from stored columns is rounded; a freshly measured one is
    // not. Comparing raw floats would call a pin different from itself and keep
    // the chip up forever.
    const p = row({ ...rawFix, latitude: 47.0502013333, longitude: 8.3095024444 });
    const d = draft({ location: locationFromRow({ ...rawFix, latitude: 47.050201, longitude: 8.309502 }) });
    expect(suggestsPlace(p, d)).toBe(true);
  });
});

describe("withSuggestion", () => {
  it("promotes the curated pin over the raw fix the row arrived with", () => {
    const p = row(rawFix);
    const d = draft({ location: locationFromRow(p) });
    expect(withSuggestion(p, d).location).toEqual(curated);
  });

  it("leaves a pin the user chose alone", () => {
    const mine: TxLocation = { ...curated, label: "My spot" };
    const p = row(rawFix);
    expect(withSuggestion(p, draft({ location: mine })).location).toEqual(mine);
  });
});

describe("hasSuggestion", () => {
  it("counts a place on its own", () => {
    const p = row(rawFix);
    expect(hasSuggestion(p, draft({ location: locationFromRow(p) }))).toBe(true);
  });

  it("is false once every field has been taken", () => {
    const p = row({ ...rawFix, suggested_description: "Coop" });
    expect(hasSuggestion(p, draft({ description: "Coop", location: curated }))).toBe(false);
  });
});
