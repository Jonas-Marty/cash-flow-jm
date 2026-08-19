# Keep the statement document viewable and link it from matched transactions

Today the uploaded statement file is read into memory, sent to the AI, and thrown away. Only the file name survives, so there is nothing to open later and nothing a transaction could point at. Two changes fix that.

## 1. Keep the file

- On import, the file is uploaded to a new private storage bucket (`statement-files`), under a per-user path, before extraction runs. Nothing changes about the extraction itself.
- `statement_imports` gets `storage_path` and `file_type` so each import knows where its document lives.
- Deleting an import also deletes the stored file.
- Older imports have no file: they simply show no "Open" button (with a short hint that the document was not kept).

## 2. Open the document

- A file button next to the statement in the list and in the detail header opens the document in a **new browser tab** (`target="_blank"`, `rel="noopener noreferrer"`).
- The link is a short-lived signed URL created on demand by a server function, so the bucket stays private and no permanent public URL exists.

## 3. Link back from a transaction

- Each statement line already stores `matched_transaction_id`. That gives the reverse lookup: transaction -> statement line -> statement import.
- On the transaction edit screen a "Statement" row appears when the transaction is referenced by a statement line: file name and period, with two actions — open the document in a new tab, and jump to `/statements?import=<id>` to see the line in context.
- In the transactions list, matched transactions get a small paperclip/document chip with the same jump target, so it is visible without opening the entry.
- The lookup is one batched query per visible page, so the list does not get slower per row.

## Technical notes

- Migration: private bucket `statement-files` with owner-scoped storage policies (`auth.uid()` = first path segment); `ALTER TABLE public.statement_imports ADD COLUMN storage_path text, ADD COLUMN file_type text`.
- `runStatementExtraction` (`src/utils/statements.detail.server.ts`) uploads the decoded bytes before parsing and persists `storage_path`/`file_type`; `deleteStatementImport` removes the object.
- New server functions in `src/utils/statements.functions.ts`:
  - `getStatementFileUrl({ id })` -> signed URL (e.g. 5 min).
  - `getStatementRefsForTransactions({ ids })` -> for each transaction id: `{ import_id, file_name, period_from, period_to, line_no }`.
- `StatementImport` in `src/lib/ai/statementTypes.ts` gains `storage_path` and `file_type`.
- UI: `src/routes/statements.tsx` (open buttons), `src/routes/edit.$id.tsx` / `src/routes/add.tsx` edit view (statement row), `src/routes/transactions.tsx` (chip). New i18n keys in both languages.
- Version bump in `package.json` as usual.
