// Typing rules for tag suggestions, shared by every field that offers them.
// Pure, so the rules are testable; the components only wire keys and caret.
//
// Two kinds of field:
//   "note" – free text in which a tag is a `#word` token. Suggestions open
//            once `#` is typed, exactly as in the Add form's note.
//   "tags" – a field that holds nothing but tags (the statement table's Tags
//            column). Every word is a tag, `#` optional, so suggestions open
//            as soon as the field is focused.

export type TagFieldMode = "note" | "tags";

export interface ActiveTag {
  /** Where the token being typed starts (at its `#`, if it has one). */
  start: number;
  /** The caret; the token is replaced up to here. */
  end: number;
  /** What has been typed of the tag name, without `#`. */
  query: string;
}

const TAG_CHAR = /[\p{L}\p{N}_-]/u;
const TAG_NAME = /^[\p{L}\p{N}_-]*$/u;
// In a tags field, a comma separates tags as well as whitespace does.
const TAGS_SEPARATOR = /[\s,]/;

/**
 * The tag token at the caret, or null when the caret is not in one. Only
 * offered at the end of a token: with tag characters right after the caret
 * the user is editing inside a word, and replacing it would eat the rest.
 */
export function detectActiveTag(
  value: string,
  caret: number,
  mode: TagFieldMode,
): ActiveTag | null {
  const after = value[caret];
  if (after && TAG_CHAR.test(after)) return null;

  if (mode === "note") {
    for (let i = caret - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "#") {
        // A `#` inside a word (an anchor, "C#") does not start a tag.
        if (i > 0 && !/\s/.test(value[i - 1])) return null;
        return { start: i, end: caret, query: value.slice(i + 1, caret) };
      }
      if (!TAG_CHAR.test(ch)) return null;
    }
    return null;
  }

  let start = caret;
  while (start > 0 && !TAGS_SEPARATOR.test(value[start - 1])) start--;
  const token = value.slice(start, caret);
  const query = token.startsWith("#") ? token.slice(1) : token;
  if (!TAG_NAME.test(query)) return null;
  return { start, end: caret, query };
}

/** Tags already in the field, lowercase and without `#`. */
export function tagsInField(value: string, mode: TagFieldMode): Set<string> {
  if (mode === "note") {
    const found = value.match(/#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu) ?? [];
    return new Set(found.map((m) => m.slice(1).toLowerCase()));
  }
  return new Set(
    value
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, "").toLowerCase())
      .filter((t) => t && TAG_NAME.test(t)),
  );
}

/**
 * Suggestions for the token being typed: known tags not yet in the field that
 * contain the query, names starting with it first, otherwise in the given
 * (usage) order.
 */
export function suggestTags(
  ranked: string[],
  active: ActiveTag | null,
  present: Set<string>,
  limit = 8,
): string[] {
  if (!active) return [];
  const q = active.query.toLowerCase();
  const hits = ranked.filter((t) => !present.has(t) && t.toLowerCase().includes(q));
  const prefix = hits.filter((t) => t.toLowerCase().startsWith(q));
  const inner = hits.filter((t) => !t.toLowerCase().startsWith(q));
  return [...prefix, ...inner].slice(0, limit);
}

/**
 * Replace the token being typed with `#tag`. In a tags field a space always
 * follows, so the next tag can be typed (and suggested) straight away; in a
 * note only when text follows that would otherwise run into the tag.
 */
export function insertTag(
  value: string,
  active: ActiveTag,
  tag: string,
  mode: TagFieldMode,
): { value: string; caret: number } {
  const before = value.slice(0, active.start);
  const after = value.slice(active.end);
  const spaced = /^\s/.test(after);
  const gap = mode === "tags" ? (spaced ? "" : " ") : after.length > 0 && !spaced ? " " : "";
  const inserted = `#${tag}${gap}`;
  return { value: before + inserted + after, caret: before.length + inserted.length };
}

/** A tags field's text for a list of tag names: `#a #b`, like tags everywhere else. */
export function formatTags(tags: string[]): string {
  return tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ");
}
