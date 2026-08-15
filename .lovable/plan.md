# Recurring rules: preview with per-occurrence actions

## Status of the reported error

The ambiguity error `interpolate_template(text, date, date, date, date, date, integer, text) is not unique` came from two overloads of that function coexisting in the database. The recurrence engine v2 migration dropped the old overloads and installed a single 7-argument version, and the live database now has exactly one `interpolate_template`. So the error is no longer reproducible here.

Caveat: a self-hosted instance that never ran the v2 migration cleanly (or ran it with old overloads recreated afterwards) can still have duplicates. To make that safe, add a small idempotent migration that drops every stale overload except the current signature.

## What already exists

- Preview panel in the rule editor: calls the preview function, lists dates for roughly -3 months to +12 months, marks each row Past/Future, and renders resolved description/note plus split slices.
- Bulk backfill on save: radio choices "none / create as posted / create as pending" (gap variant offers only none/pending), applied via the backfill routine after saving.
- Dashboard "Upcoming & due": posts a single occurrence through a dialog where date, description, note and amount can be adjusted before posting.

## What is missing

1. The preview shows only computed dates. It does not know which dates already have an occurrence, whether it is posted or pending, or which transaction it created.
2. No way to jump from a preview row to the already generated entry (edit the transaction, or the pending occurrence).
3. No per-row "create this missing entry" action — only the all-or-nothing backfill on save.
4. The post dialog is dashboard-only and requires an existing occurrence row.
5. Nothing hides these actions for a rule that is not saved yet.

## Proposed implementation

**Merge real occurrences into the preview.** When editing a rule, load its occurrences (id, due_on, effective_on, status, transaction_id) — the editor already loads a reduced version of this for the backfill logic; extend that query. Key preview rows by `due_on` and attach the matching occurrence.

**Per-row state and actions** (edit mode only; for a new rule the rows stay purely informational):

- Posted → status chip "Posted" plus a pencil button that opens the existing transaction in the transaction editor (navigate to the transaction edit route with the linked transaction id).
- Pending → chip "Pending" plus a "Post now" button.
- Past date with no occurrence → chip "Missing" plus a "Create" button.
- Future date with no occurrence → unchanged "Future".

**Create / post flow.** Reuse the dashboard post dialog. It requires an occurrence record, so for a missing row first insert a pending occurrence for that rule/due date, then open the same dialog pre-filled with the row's date, resolved description/note and the rule amount (estimate for variable-amount rules). Cancelling before posting removes the just-created placeholder so no stray pending rows accumulate. For a pending row, open the dialog directly on the existing occurrence. On success, refresh the preview and occurrence query.

**Guard rails.** All per-row actions are hidden when the rule is unsaved; also hidden while the draft schedule differs from the saved rule (rows would refer to dates the saved rule does not produce) — in that case show a short hint to save first. Preview list gets a taller scroll area since rows now carry action buttons.

**Database.** One defensive migration that removes any leftover `interpolate_template` overloads whose signature differs from the current 7-argument one, so self-hosted instances converge on a single function.

## Technical notes

- Files: `src/components/RecurringRulesCard.tsx` (occurrence merge, row actions, guards), `src/components/PostOccurrenceDialog.tsx` (accept a pre-filled description/note override), `src/lib/finance.ts` (helper to create a single pending occurrence for a rule + due date), `src/i18n/index.tsx` (new labels), plus one SQL migration.
- Run number passed to the dialog is derived from the row index within the rule's series so placeholders resolve consistently with the preview.
