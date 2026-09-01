# Tabular entry for statement import

Turn the "Missing on statement" section into an editable table so most rows can be booked in one go, while unusual rows can still go through the full add-transaction page.

## What you get

- Every missing statement line becomes an editable row with: checkbox, date, amount, description, category, tags, note, and place.
- Fields are pre-filled from the AI suggestions already stored on the line (suggested description, category, tags), so most rows only need a glance.
- Place: a compact button per row opens a small overlay with the map and a search box (same search + pin behaviour as the add page), and stores label plus coordinates.
- Checkbox per row selects which lines to commit. A header checkbox selects/deselects all, and rows with no category (or otherwise incomplete) are flagged before commit.
- "Book selected (n)" creates all checked rows as real transactions in one action, links each created transaction back to its statement line (line becomes "resolved" and shows the ↔ backlink), and refreshes the section.
- Unchecked rows simply stay in the missing list with the existing "Create" button, so you can open the full add dialog for splits, transfers, reimbursables, fees, etc.
- Amount sign and account come from the statement line and the import's account; the type (expense/income) is derived from the sign and shown as a small read-only marker.
- Errors are per row: if one insert fails, the others still commit and the failing rows stay checked with an inline message.

## Technical outline

New/changed files:

- `src/components/statements/StatementLineTable.tsx` (new): the table/card grid. Desktop renders a real table; mobile stacks each row into a compact card (matching the existing responsive approach in transactions). Local draft state per line id, seeded from `suggested_*` fields, kept while the import stays open.
- `src/components/statements/StatementPlaceDialog.tsx` (new): thin wrapper around the existing `LocationSection`/`LocationMiniMap` + `geocode.functions` search so the map overlay reuses current geocoding (Nominatim/Photon) and recent pins.
- `src/routes/statements.tsx`: replace the plain `missing` section render with the new table; keep the existing per-row "Create" link and ignore action inside it.
- `src/utils/statements.functions.ts` (new server fn `commitStatementLines`): accepts an array of `{ line_id, occurred_on, amount, type, description, note, category_id, tags, location }`, validated with zod (max ~200 rows).
- `src/utils/statements.detail.server.ts`: implementation — for each row insert into `transactions` (user scoped, `source_account_id` = import account), append tag hashtags to `note` so the existing `sync_transaction_tags` trigger indexes them, then apply the existing `link` decision to the line (sets `match_status = 'resolved'` and `matched_transaction_id`). Returns per-row `{ line_id, ok, transaction_id?, error? }` plus the rebuilt import detail.
- `src/i18n/index.tsx`: new EN/DE keys for the table headers, place picker, commit button, and validation/commit toasts.
- `package.json`: bump patch version.

No database migration is needed — statement lines already carry the suggestion fields and the `matched_transaction_id` link used for the backlink.
