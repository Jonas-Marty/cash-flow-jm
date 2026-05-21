## Goal

Polish the recurring-rule split feature: show splits in places it's still missing, simplify the editor when a rule is split, support placeholders and tag-completion on slices, and allow auto-post for deterministic splits.

## 1. Rule editor: hide top-level fields when split is active

When `is_split = true` and `type !== "transfer"`:

- Hide rule-level **Category**, **Description**, **Note** and their PlaceholderPalette.
- Keep **Name**, **Amount/Estimated**, **Account**, schedule, dates, toggles.
- On save, force `category_id`, `description`, `note` to `null` for split rules (no leftovers from before the toggle).

## 2. Slice editor: add Note + placeholder + tag-completion

Each slice currently has Amount/Ratio, Category, Description, Reimbursable fields. Extend with:

- **Note** field using `TagAutocompleteTextarea` (same component the Add Transaction screen uses), so `#tag` completion works against past transactions.
- A single **PlaceholderPalette** rendered above the slice list. Insert into the most recently focused slice field (description or note). Track active slice via `{ sliceIdx, field }` state (mirrors the existing `activeField` pattern for the top-level fields).
- Description input stays a plain `Input` but participates in caret-insert too.

Posting path (`postOccurrence` in `src/lib/finance.ts`) currently writes `s.description` / `s.note` verbatim. Change it to run `interpolate(...)` on both, using the same context PostOccurrenceDialog already builds (date, dueDate, prevDate, nextDate, runNumber, locale). Compute `prevDate`/`nextDate`/`runNumber` by reading sibling occurrences for the rule (one extra query). Apply identical interpolation for both the manual-post and (future) auto-post path.

## 3. Settings rules list: show slices

In `renderRule` (settings list), when `r.is_split`:

- Add a small `<ul>` below the existing meta line listing each slice as
`{amount or ratio} · {category name} · {description}` plus a 🔁 badge when `is_reimbursable`.
- Add a `Split` badge next to the existing Auto/Variable badges. Add `Variable date` badge when `is_variable_date`.

`fetchRecurringRules` already returns `slices`, no fetcher change needed.

## 4. PreviewPanel: reflect splits and render note as Markdown

`PreviewPanel` currently shows date + resolved description per occurrence. Extend it:

- When `draft.is_split`, render the slices under each occurrence row: amount (computed via `computeSliceAmounts` from `recurringSlices.ts`) + interpolated slice description + reimbursable chip. For variable-amount split rules, use `estimated_amount` (or `amount` fallback) as the total so the preview can compute slice amounts; show "—" per row when no total is available.
- When `draft.note` is set, render it via `<Markdown>` (component already exists at `src/components/Markdown.tsx`) below the description, mirroring the Add Transaction preview card.
- When split, render each slice's note via `<Markdown>` as well.

## 5. Allow auto-post for deterministic splits

Today both the JS (`postOccurrence` works fine) and SQL (`process_recurring_rules`) treat `is_split = true` as non-auto-postable. There's no technical reason: when amount + date are fixed and slices are fixed-amount or fixed-ratio, the result is fully deterministic.

Changes:

- **Editor**: drop `is_split` from the "cannot auto-post" condition. Keep `is_variable_amount` and `is_variable_date` as auto-post blockers. Update the helper text under the Auto-post switch.
- **Save payload**: `auto_post` only forced to `false` when `is_variable_amount || is_variable_date`.
- **SQL migration** (`process_recurring_rules` and `process_recurring_rules_for_all_users`): remove `is_split = false` from Pass 1 and Pass 2 guards. Instead, when `r.is_split = true`, fan out into N transaction inserts by looping `recurring_rule_slices` ordered by `sort_order`, sharing a generated `split_group_id` (`gen_random_uuid()`), running `interpolate_template` on each slice's `description` and `note`, applying `is_reimbursable` / `reimbursable_*` from the slice row, and computing slice amounts:
  - Ratio mode: `round(rule.amount * slice.amount_ratio, 2)`, with last slice absorbing remainder so the sum matches `rule.amount` to the cent.
  - Fixed mode: use `slice.amount` as-is.
  Attach `recurring_rule_id = r.id` to every row and store the first inserted tx id on the occurrence (matches the JS path).
- New migration only — the existing `_efbee535_` migration stays read-only.

## 6. Tests

Extend `src/lib/recurringSlices.test.ts` with a small case asserting `computeSliceAmounts` returns the same shape used by the SQL fan-out (already covered) — no new test file needed.

## Technical notes

- Files touched (code): `src/components/RecurringRulesCard.tsx`, `src/lib/finance.ts`, `src/i18n/index.tsx` (a handful of new labels: split note, variable-date badge, "auto-post for splits" help text). Slice type already carries `note`.
- New migration: `process_recurring_rules` + `_for_all_users` rewritten to handle split fan-out and to drop the `is_split = false` guard.
- No schema changes (slice `note` column already exists).
- No new components; reuse `TagAutocompleteTextarea`, `Markdown`, `PlaceholderPalette`, `computeSliceAmounts`.

## Open question (please confirm before I implement step 1)

Currently the rule's top-level Description still has a legitimate use even when split (e.g. as a parent label, though we no longer write it to any transaction). My plan is to **hide and null it out** when `is_split` is on. Confirm — or say "keep description visible as a label only" and I'll keep it but mark it as unused for posting. --> plan to hide and null it out is the way to go - but only do that when saving the rule. It would frutrate me as a user if i togle the is_split and back just to try it out and lose the content of the description field at this moment.