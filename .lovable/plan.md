# Bulk operations and a compact table view for Transactions

Two additions to `/transactions`, both working on top of the existing filters (which already live in the URL).

## 1. Compact table view

- A view switcher in the toolbar: **Cards** (today's rich rows) and **Table** (new compact view). The choice is stored in the URL search params so it survives edit round trips and can be bookmarked.
- Table columns: date, description (with split/recurring/reimbursement markers as small icons instead of full chips), category, account, tags, amount.
- Fixed table header while scrolling, tighter row height, amounts right-aligned and monospaced.
- On mobile the table collapses to a condensed one-line-per-transaction list (date + description left, amount right, category/tags on a second small line) so it stays usable at 411px.
- Clicking a row still opens the transaction for editing, same as today.

## 2. Bulk operations

- Selection checkboxes appear in both views: per row, plus a header checkbox that selects everything currently matching the filters. A sticky action bar shows "N selected" with Clear.
- Actions in the bar:
  - **Set category** — pick one category, applied to all selected non-transfer transactions (transfers are skipped and reported).
  - **Add tags** — enter one or more tags, appended to each selected transaction if not already present.
  - **Remove tags** — pick from the tags actually present in the selection; removed from each.
  - **Delete** — with a confirmation dialog naming the count.
- Every action shows a confirmation summary before running and a result toast ("42 updated, 3 skipped"). Failures on individual rows do not abort the rest.

## Technical notes

- Tags are not stored directly: the `sync_transaction_tags` trigger derives `transaction_tags` from `#tokens` in a transaction's `note`. Bulk tag add/remove therefore rewrites the `note` text (append `#tag`, or strip the matching `#tag` token with surrounding whitespace normalized) and lets the trigger re-index. This keeps self-hosted instances consistent and needs no migration.
- Category updates go through a single `update ... in (ids)` batched in chunks (e.g. 200 ids) via the existing Supabase client; deletes likewise, so existing cascade triggers (splits, reimbursement links, transfer fees) still fire.
- New helpers in `src/lib/finance.ts`: `bulkSetCategory`, `bulkAddTags`, `bulkRemoveTags`, `bulkDeleteTransactions`, each returning `{ updated, skipped, errors }`.
- New component `src/components/transactions/TransactionTable.tsx` for the table view; selection state and the bulk action bar live in `src/routes/transactions.tsx`.
- After each bulk action, invalidate `transactions`, `transaction_tags` and dependent budget queries.
- New EN/DE strings in `src/i18n/index.tsx`; patch-level version bump in `package.json`.

No database migration is required.
