# Statement import: read a PDF, match it against your transactions

Goal: upload a bank or credit-card statement PDF, have the AI extract the line items, compare them to what is already recorded in Cashflow, and show what is missing, duplicated, or likely mis-categorised — with one-click fixes.

## How the pipeline would work

```text
PDF  ->  text extraction  ->  AI line-item extraction  ->  deterministic matcher  ->  review screen  ->  actions
       (in-app, no AI)      (your AI connection)         (code, no AI)             (you decide)
```

Only steps 2 is AI. Matching stays deterministic code so numbers are never invented.

## Decision 1 — where the PDF comes from

- **A1 Direct upload (recommended start).** Drop the file on a new "Import statement" screen; it is parsed in memory and never stored.
- **A2 Nextcloud picker.** Reuse the existing file picker, fetch the PDF server-side from your Nextcloud. Nice for "statements already filed", needs a download helper the app doesn't have yet.
- **A3 Both.** A1 first, A2 as a follow-up. Low extra cost once A1 exists.

## Decision 2 — how the PDF becomes text

- **B1 Text-layer extraction only.** A pure-JS PDF library extracts the embedded text. Fast, free, works for every statement your bank generates digitally. Scanned/photographed statements produce nothing and are rejected with a clear message.
- **B2 Text layer + vision fallback.** If no text layer is found, send page images to a vision-capable AI connection. Costs more, needs a model that accepts images, and the app's server runtime cannot rasterise PDFs — so rasterising would have to happen in the browser before upload.
- **B3 Text layer + per-bank parser rules.** After a successful import, remember the layout per account so later statements of the same bank are parsed without AI at all (cheap, deterministic, improves over time).

Recommendation: B1 now, B3 later, B2 only if you actually have scanned statements.

## Decision 3 — how strict the matching is

The matcher compares extracted rows against transactions of the selected account within the statement period:

1. Exact: same amount, date within +/- N days (default 3), description similarity above threshold.
2. Amount-only: same amount in the window, no description match -> "probable".
3. Unmatched statement row -> **missing in Cashflow**.
4. Unmatched app transaction inside the period -> **not on the statement** (typo, wrong account, or duplicate).
5. Matched but the app amount/date/account differs -> **discrepancy**.

Optional AI second pass: for rows still unmatched, ask the AI to propose pairings from a shortlist (never to decide alone) and to suggest a category based on your own historical descriptions.

## Decision 4 — scope of the first version

- **D1 Read-only report.** Import, compare, list findings, no writes. Safest, quickest.
- **D2 Report + guided actions (recommended).** Each finding gets a button: create the missing transaction (prefilled `/add`), open the existing one, mark as ignored, or fix the category. You confirm every write.
- **D3 Bulk apply.** Select many findings and apply them in one go. Powerful, but easy to pollute the ledger; best added after D2 has proven itself.

Statement totals also feed the existing Reconcile feature: the closing balance from the PDF can create an account statement row automatically, so the balance check and the line-item check agree.

## Technical outline

- New table `statement_imports` (account_id, period_from/to, closing_balance, source_name, status) plus `statement_import_lines` (booking_date, value_date, description, amount, raw_text, match_status, matched_transaction_id, decision). Both user-scoped with RLS and grants; lines cascade from the import.
- Server functions in `src/utils/statements.functions.ts` with logic in `src/utils/statements.server.ts`:
  - `extractStatement` — parse the PDF text, call the resolved AI connection with a strict JSON schema (date, description, amount, sign), return normalised rows.
  - `matchStatementImport` — pure comparison against `transactions`, writes `match_status` per line.
  - `resolveStatementLine` — apply one user decision.
- Reuses the existing multi-connection AI layer: a new `statement_extract` action in `AI_ACTIONS`, so you can point extraction at a different (stronger) endpoint than chat, with the same fallback logic and audit logging.
- PDF text extraction with a pure-JS, worker-compatible library (no native binaries, no `child_process`), executed inside the server function handler.
- New route `src/routes/statements.tsx`: upload panel, extraction preview table, findings grouped by type, per-row actions. Linked from Reconcile and the nav.
- Amount sign normalisation per account type (credit-card statements invert), currency check against the account, duplicate detection inside the statement itself.

## Known pitfalls

- Statement dates are booking dates; your entry date may differ by days — hence the configurable window.
- Split transactions in the app map to one statement line: the matcher sums slices of the same parent before comparing.
- Foreign-currency card rows show both original and settled amounts; only the settled amount is matched.
- Re-importing the same statement must not duplicate findings: imports are keyed by account + period + closing balance.
- Large PDFs can exceed a model's context: extraction runs page-batched and streams, to avoid long buffered calls.

## Suggested combination

A1 + B1 + D2, with the AI second pass for category suggestions, and B3/A2/D3 as later increments.
