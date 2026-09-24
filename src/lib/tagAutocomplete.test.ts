import { describe, expect, it } from "vitest";
import {
  detectActiveTag,
  formatTags,
  insertTag,
  suggestTags,
  tagsInField,
} from "./tagAutocomplete";

const at = (text: string) => {
  // `|` marks the caret.
  const caret = text.indexOf("|");
  return { value: text.replace("|", ""), caret };
};

describe("detectActiveTag in a note", () => {
  it("opens once # is typed and follows what comes after it", () => {
    const a = at("Einkauf #|");
    expect(detectActiveTag(a.value, a.caret, "note")).toEqual({ start: 8, end: 9, query: "" });
    const b = at("Einkauf #co|");
    expect(detectActiveTag(b.value, b.caret, "note")?.query).toBe("co");
  });

  it("stays shut for plain words, which are just note text", () => {
    const a = at("Einkauf co|");
    expect(detectActiveTag(a.value, a.caret, "note")).toBeNull();
  });

  it("ignores a # inside a word", () => {
    const a = at("C#|");
    expect(detectActiveTag(a.value, a.caret, "note")).toBeNull();
  });
});

describe("detectActiveTag in a tags field", () => {
  it("treats every word as a tag, with or without #", () => {
    const a = at("co|");
    expect(detectActiveTag(a.value, a.caret, "tags")).toEqual({ start: 0, end: 2, query: "co" });
    const b = at("#coop #mi|");
    expect(detectActiveTag(b.value, b.caret, "tags")).toEqual({ start: 6, end: 9, query: "mi" });
  });

  it("offers everything in an empty field and after a separator", () => {
    const a = at("|");
    expect(detectActiveTag(a.value, a.caret, "tags")?.query).toBe("");
    const b = at("#coop, |");
    expect(detectActiveTag(b.value, b.caret, "tags")).toEqual({ start: 7, end: 7, query: "" });
  });

  it("takes a comma as a separator even without a space", () => {
    const a = at("#coop,mi|");
    expect(detectActiveTag(a.value, a.caret, "tags")).toEqual({ start: 6, end: 8, query: "mi" });
  });

  it("says nothing while the caret is inside a word", () => {
    const a = at("co|op");
    expect(detectActiveTag(a.value, a.caret, "tags")).toBeNull();
  });
});

describe("tagsInField", () => {
  it("reads #tags from a note and ignores plain words", () => {
    expect([...tagsInField("Einkauf #Coop bei coop #bio-food", "note")]).toEqual([
      "coop",
      "bio-food",
    ]);
  });

  it("reads every word of a tags field, # or not, comma or space", () => {
    expect([...tagsInField("#coop, migros  #Bio", "tags")]).toEqual(["coop", "migros", "bio"]);
  });
});

describe("suggestTags", () => {
  const ranked = ["lebensmittel", "coop", "migros", "bio-coop", "ferien"];

  it("puts names starting with the query first, then keeps usage order", () => {
    expect(suggestTags(ranked, { start: 0, end: 2, query: "co" }, new Set())).toEqual([
      "coop",
      "bio-coop",
    ]);
  });

  it("leaves out tags already in the field", () => {
    expect(
      suggestTags(ranked, { start: 0, end: 0, query: "" }, new Set(["coop", "ferien"])),
    ).toEqual(["lebensmittel", "migros", "bio-coop"]);
  });

  it("matches case-insensitively, anywhere in the name", () => {
    // "lebensmittel" ranks higher by use, but "migros" starts with the query.
    expect(suggestTags(ranked, { start: 0, end: 2, query: "MI" }, new Set())).toEqual([
      "migros",
      "lebensmittel",
    ]);
  });

  it("offers nothing when no tag is being typed", () => {
    expect(suggestTags(ranked, null, new Set())).toEqual([]);
  });
});

describe("insertTag", () => {
  it("in a tags field, writes #tag and a space so the next tag can follow", () => {
    const a = at("#coop mi|");
    const active = detectActiveTag(a.value, a.caret, "tags")!;
    expect(insertTag(a.value, active, "migros", "tags")).toEqual({
      value: "#coop #migros ",
      caret: 14,
    });
  });

  it("in a note, adds a space only when text follows", () => {
    const a = at("Einkauf #co|");
    const end = detectActiveTag(a.value, a.caret, "note")!;
    expect(insertTag(a.value, end, "coop", "note")).toEqual({ value: "Einkauf #coop", caret: 13 });

    const b = at("Einkauf #co| heute");
    const mid = detectActiveTag(b.value, b.caret, "note")!;
    expect(insertTag(b.value, mid, "coop", "note").value).toBe("Einkauf #coop heute");
  });
});

describe("formatTags", () => {
  // The statement table showed suggested tags as "coop" while its placeholder
  // and every other screen write "#coop".
  it("writes tags with #, whether or not they came with one", () => {
    expect(formatTags(["coop", "#migros"])).toBe("#coop #migros");
  });
});
