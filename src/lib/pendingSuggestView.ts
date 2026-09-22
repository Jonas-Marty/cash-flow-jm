/**
 * Which suggestions a pending row is still offering, and what taking them does.
 *
 * Pure, and shared: `/pending` renders the same row twice — as a card
 * (`routes/pending.tsx`) and as a table line (`components/pending/PendingLineTable.tsx`).
 * Both used to carry their own copy of these predicates, and the copies had
 * already drifted: one tested the note line by line, the other with
 * `String.includes`, so the same row offered a remark in one view and not the
 * other. One module, one answer, and a unit test can reach it.
 *
 * A suggestion "still counts" while the draft has not taken it. That is a
 * comparison against the draft, never against the row — the user editing a
 * field is what retires the chip.
 */

import { locationFromRow, sameLocation, type TxLocation } from "./location";
import { addTagsToNote } from "./finance";

/** The fields of an edit-in-progress these predicates look at. */
export interface SuggestionDraft {
  category_id: string;
  description: string;
  note: string;
  location: TxLocation | null;
}

/** The suggestion fields of a pending row, plus what it arrived carrying. */
export interface SuggestedRow {
  type: string;
  suggested_category_id: string | null;
  suggested_description: string | null;
  suggested_note: string | null;
  suggested_location: TxLocation | null;
  suggested_tags: string[];
  latitude?: number | string | null;
  longitude?: number | string | null;
  location_accuracy_m?: number | string | null;
  location_label?: string | null;
  location_source?: string | null;
}

export function suggestsCategory(p: SuggestedRow, d: SuggestionDraft): boolean {
  return !!p.suggested_category_id && !d.category_id && p.type !== "transfer";
}

export function suggestsDescription(p: SuggestedRow, d: SuggestionDraft): boolean {
  return !!p.suggested_description && p.suggested_description !== d.description;
}

export function suggestsNote(p: SuggestedRow, d: SuggestionDraft): boolean {
  return !!p.suggested_note && !noteContains(d.note, p.suggested_note);
}

/**
 * Whether to offer the proposed place.
 *
 * Three states, not a null check. The draft is seeded from the row's own
 * coordinates, so a row that arrived with a device fix always has a draft
 * location — and `!d.location` made the chip unreachable for exactly the rows
 * a place suggestion is for. What matters is not whether the draft has a
 * location but whether the *user* has chosen one: while the draft still holds
 * the raw fix the row came with, the curated pin is worth offering.
 */
export function suggestsPlace(p: SuggestedRow, d: SuggestionDraft): boolean {
  if (!p.suggested_location) return false;
  if (!d.location) return true;
  return (
    sameLocation(d.location, locationFromRow(p)) &&
    !sameLocation(d.location, p.suggested_location)
  );
}

/** Whether this row is offering anything at all. */
export function hasSuggestion(p: SuggestedRow, d: SuggestionDraft): boolean {
  return (
    suggestsCategory(p, d) ||
    suggestsDescription(p, d) ||
    suggestsNote(p, d) ||
    suggestsPlace(p, d)
  );
}

/** Whether the remark is already in the note, tags and all. */
export function noteContains(note: string, suggested: string): boolean {
  return note.split(/\s*\n\s*/).some((line) => line.trim() === suggested.trim());
}

/**
 * Adds the suggested remark without displacing what is already there — the
 * note also carries the tag line that `addTagsToNote` maintains.
 */
export function withSuggestedNote(note: string, suggested: string | null): string {
  if (!suggested || noteContains(note, suggested)) return note;
  return note.trim() ? `${suggested}\n${note}` : suggested;
}

/** The tap that promotes a suggestion: it only ever touches the draft. */
export function withSuggestion(p: SuggestedRow, d: SuggestionDraft): SuggestionDraft {
  const withNote = withSuggestedNote(d.note, p.suggested_note);
  return {
    category_id: suggestsCategory(p, d) ? p.suggested_category_id! : d.category_id,
    description: p.suggested_description ?? d.description,
    note: p.suggested_tags.length ? addTagsToNote(withNote, p.suggested_tags) : withNote,
    location: suggestsPlace(p, d) ? p.suggested_location : d.location,
  };
}
