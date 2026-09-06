import { describe, expect, it } from "vitest";
import {
  MIN_HISTORY_CONFIDENCE,
  parseModelSuggestions,
  suggestFromHistory,
  type HistoryTx,
  type PendingLike,
} from "./pendingSuggest";

const GROCERIES = "11111111-1111-4111-8111-111111111111";
const EATING_OUT = "22222222-2222-4222-8222-222222222222";

function tx(
  description: string,
  category_id: string | null,
  occurred_on = "2026-08-01",
  type = "expense",
): HistoryTx {
  return { description, category_id, type, occurred_on };
}

function row(over: Partial<PendingLike> = {}): PendingLike {
  return { description: null, external_info: null, location_label: null, type: "expense", ...over };
}

describe("suggestFromHistory", () => {
  it("finds the merchant inside the raw notification text", () => {
    const s = suggestFromHistory(
      row({
        description: "Twint payment",
        external_info: "TWINT\nCHF 12.50 an Bäckerei Hug, Luzern bezahlt",
      }),
      [tx("Bäckerei Hug", GROCERIES, "2026-07-02"), tx("Bäckerei Hug", GROCERIES, "2026-08-14")],
    );
    expect(s).not.toBeNull();
    expect(s!.category_id).toBe(GROCERIES);
    expect(s!.description).toBe("Bäckerei Hug");
    expect(s!.matches).toBe(2);
    expect(s!.confidence).toBeGreaterThanOrEqual(MIN_HISTORY_CONFIDENCE);
  });

  it("prefers an exact description match over a containment match", () => {
    const s = suggestFromHistory(
      row({
        description: "Coop Pronto",
        external_info: "Card payment COOP PRONTO LUZERN CHF 8.40",
      }),
      [tx("Coop", GROCERIES), tx("Coop", GROCERIES), tx("Coop Pronto", EATING_OUT)],
    );
    expect(s!.description).toBe("Coop Pronto");
    expect(s!.category_id).toBe(EATING_OUT);
  });

  it("matches whole words only, so Coop does not light up on cooperative", () => {
    const s = suggestFromHistory(
      row({ description: "Membership", external_info: "Annual cooperative membership fee" }),
      [tx("Coop", GROCERIES), tx("Coop", GROCERIES), tx("Coop", GROCERIES)],
    );
    expect(s).toBeNull();
  });

  it("ignores the other transaction type and transfers altogether", () => {
    const history = [tx("Salary", EATING_OUT, "2026-08-01", "income")];
    expect(suggestFromHistory(row({ description: "Salary" }), history)).toBeNull();
    expect(
      suggestFromHistory(row({ description: "Salary", type: "transfer" }), history),
    ).toBeNull();
  });

  it("grows confidence with agreement and shrinks it with disagreement", () => {
    const one = suggestFromHistory(row({ description: "Migros" }), [tx("Migros", GROCERIES)]);
    const three = suggestFromHistory(row({ description: "Migros" }), [
      tx("Migros", GROCERIES),
      tx("Migros", GROCERIES),
      tx("Migros", GROCERIES),
    ]);
    const split = suggestFromHistory(row({ description: "Migros" }), [
      tx("Migros", GROCERIES),
      tx("Migros", GROCERIES),
      tx("Migros", EATING_OUT),
    ]);
    expect(one!.confidence).toBe(0.75);
    expect(three!.confidence).toBe(1);
    expect(split!.category_id).toBe(GROCERIES);
    expect(split!.confidence).toBeLessThan(three!.confidence);
  });

  it("says nothing when history only repeats the row's own wording without a category", () => {
    expect(
      suggestFromHistory(row({ description: "Kiosk" }), [tx("Kiosk", null), tx("kiosk", null)]),
    ).toBeNull();
  });

  it("uses the most recent spelling of the description", () => {
    const s = suggestFromHistory(row({ description: "bäckerei hug" }), [
      tx("Baeckerei Hug", GROCERIES, "2026-01-01"),
      tx("Bäckerei Hug", GROCERIES, "2026-08-01"),
    ]);
    expect(s!.description).toBe("Bäckerei Hug");
  });
});

describe("suggestFromHistory — note and place", () => {
  const AT_THE_BAKERY = {
    latitude: 47.0502,
    longitude: 8.3093,
    location_accuracy_m: 12,
    location_label: "Bäckerei Hug, Luzern",
    location_source: "device",
  };

  it("carries the note and the whole location from the latest match", () => {
    const s = suggestFromHistory(row({ description: "Bäckerei Hug" }), [
      { ...tx("Bäckerei Hug", GROCERIES, "2026-07-02"), note: "old" },
      { ...tx("Bäckerei Hug", GROCERIES, "2026-08-14"), note: "Znüni", ...AT_THE_BAKERY },
    ]);
    expect(s!.note).toBe("Znüni");
    expect(s!.location).toEqual({
      latitude: 47.0502,
      longitude: 8.3093,
      accuracy_m: 12,
      label: "Bäckerei Hug, Luzern",
      source: "device",
    });
  });

  it("leaves place null when history has no coordinates", () => {
    const s = suggestFromHistory(row({ description: "Bäckerei Hug" }), [
      { ...tx("Bäckerei Hug", GROCERIES), note: "Znüni", location_label: "Luzern" },
    ]);
    expect(s!.location).toBeNull();
    expect(s!.note).toBe("Znüni");
  });

  it("still suggests when only a note differs, with the wording unchanged", () => {
    // Same description, no category to offer: without a note this returns null.
    const s = suggestFromHistory(row({ description: "Bäckerei Hug" }), [
      { ...tx("Bäckerei Hug", null), note: "Znüni" },
    ]);
    expect(s).not.toBeNull();
    expect(s!.note).toBe("Znüni");
  });

  it("returns null when there is genuinely nothing new to say", () => {
    const s = suggestFromHistory(row({ description: "Bäckerei Hug" }), [tx("Bäckerei Hug", null)]);
    expect(s).toBeNull();
  });
});

describe("parseModelSuggestions", () => {
  const ids = new Set(["row-1", "row-2"]);
  const cats = new Set([GROCERIES]);

  it("keeps only known rows and known categories, normalising tags", () => {
    const out = parseModelSuggestions(
      {
        suggestions: [
          {
            pending_id: "row-1",
            description: " Bäckerei Hug ",
            category_id: GROCERIES,
            tags: ["#Bakery", "bakery", "x y"],
            confidence: 0.87,
          },
          {
            pending_id: "row-2",
            description: null,
            category_id: EATING_OUT,
            tags: [],
            confidence: 2,
          },
          { pending_id: "row-9", description: "ghost", category_id: GROCERIES, tags: [] },
        ],
      },
      ids,
      cats,
    );
    expect(out.get("row-1")).toEqual({
      description: "Bäckerei Hug",
      category_id: GROCERIES,
      note: null,
      tags: ["bakery"],
      confidence: 0.87,
    });
    // Unknown category dropped and nothing else offered → no suggestion.
    expect(out.has("row-2")).toBe(false);
    expect(out.has("row-9")).toBe(false);
  });

  it("keeps a trimmed note and lets it alone carry the suggestion", () => {
    const out = parseModelSuggestions(
      {
        suggestions: [
          {
            pending_id: "row-1",
            description: null,
            category_id: null,
            tags: [],
            note: "  Znüni  ",
          },
        ],
      },
      ids,
      cats,
    );
    expect(out.get("row-1")!.note).toBe("Znüni");
  });

  it("drops a blank note rather than storing an empty remark", () => {
    const out = parseModelSuggestions(
      { suggestions: [{ pending_id: "row-1", category_id: GROCERIES, note: "   " }] },
      ids,
      cats,
    );
    expect(out.get("row-1")!.note).toBeNull();
  });

  it("survives garbage", () => {
    expect(parseModelSuggestions(null, ids, cats).size).toBe(0);
    expect(parseModelSuggestions({ suggestions: "nope" }, ids, cats).size).toBe(0);
    expect(parseModelSuggestions({ suggestions: [null, 1, {}] }, ids, cats).size).toBe(0);
  });

  it("defaults a missing confidence rather than rejecting the row", () => {
    const out = parseModelSuggestions(
      { suggestions: [{ pending_id: "row-1", category_id: GROCERIES }] },
      ids,
      cats,
    );
    expect(out.get("row-1")!.confidence).toBe(0.5);
  });
});
