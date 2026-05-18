## Goal

Let you record what the bank/statement says an account was at a given date (any date, not just month-end), compare it against what the app computed from transactions, and — when you can't reconstruct the missing/wrong entries — post a single **compensation transaction** that snaps the computed balance to the statement.

Same flow must be available via REST so an external AI agent can submit statement balances.

## Mental model

Treat reconciliation as a first-class object, separate from transactions:

- A **statement balance** is a claim: "Account X had balance B on date D, according to source S" (bank PDF, manual entry, AI agent).
- The app already knows the **computed balance** at D via `account_balances_as_of(D)`.
- **Difference = statement − computed**. Three outcomes:
  1. Zero → mark as **matched**, done.
  2. Non-zero, you find the missing transactions → enter them, recompute, re-check, then match.
  3. Non-zero, you give up → click **"Post compensation"**. App creates a single income/expense transaction on date D in a dedicated `Reconciliation adjustment` category that makes the diff zero, and links it to the statement record.

Statements are independent of any monthly cycle; each account can have its own cadence (cash: weekly; credit card: 17th; bank: month-end). The app just stores `(account, date, amount)` tuples.

## Data model

New table `account_statements`:

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid | RLS by `auth.uid()` |
| account_id | uuid → accounts | |
| as_of | date | statement date, any day |
| statement_balance | numeric | what the bank says, in account currency |
| source | text | `manual` \| `api` \| `import` (free-form, default `manual`) |
| external_ref | text null | e.g. bank statement id, AI agent run id |
| note | text null | |
| status | text | `open` \| `matched` \| `compensated` |
| compensation_transaction_id | uuid null → transactions(id) ON DELETE SET NULL | |
| created_at / updated_at | timestamptz | |

Unique: `(account_id, as_of, source)` — re-submitting the same statement is an upsert, not a duplicate. Index on `(user_id, account_id, as_of desc)`.

No schema change to `transactions`. The compensation transaction is a regular `expense` or `income` on `source_account_id = account_id`, dated `as_of`, with `category_id` pointing to a per-user **"Reconciliation adjustment"** category (auto-created on first use). The link lives only on the statement row, so deleting either side is safe (cascade clears the FK, statement flips back to `open`).

Trigger: when a statement's linked compensation transaction is deleted, reset `status='open'`, `compensation_transaction_id=null`.

## Library (`src/lib/finance.ts`)

Add:

- `fetchAccountBalanceAsOf(accountId, date)` — single-account helper (reuse existing RPC, filter).
- `fetchAccountStatements(accountId?)` — list, newest first.
- `upsertAccountStatement({ account_id, as_of, statement_balance, source?, external_ref?, note? })` — insert or update on conflict.
- `matchStatement(id)` — sets `status='matched'` only if diff is zero (server-side guard via check in code; trigger optional).
- `postCompensation(id)` — computes diff, inserts the adjustment transaction in the user's "Reconciliation adjustment" category (auto-create if missing), stores its id, sets `status='compensated'`.
- `deleteStatement(id)` — deletes statement; optionally cascades the compensation transaction (configurable param, default no — keep the audit trail).

All four respect existing patterns (RLS, invalidate `["account_balances*"]` queries).

## UI

**New route `src/routes/reconcile.tsx`** (linked from account detail and from settings/sidebar):

- Header: account picker + "Add statement" button.
- Table per account:
  - Date · Statement · Computed · Diff · Status · Actions
  - Row actions: **Recompute**, **Match** (enabled iff diff=0), **Post compensation**, **Edit**, **Delete**.
- "Add statement" dialog: account, date (DateInput with shortcuts), amount, optional note. Sets `source='manual'`.
- Compensation confirm dialog shows: "Will create an `expense` of 12.34 CHF on 2026-05-17 in category *Reconciliation adjustment*. Continue?"

**Account list (`src/routes/index.tsx` OpenIOUsCard area or accounts settings)**: small badge "last reconciled · 12 days ago" or "never" per account; click → reconcile page filtered to that account.

i18n keys under `reconcile.*` (EN + DE).

## REST API

**New `src/routes/api.public.account-statements.ts`** following the existing `api.public.*` pattern (token auth, Zod validation):

- `POST /api/public/account-statements` — body `{ account_id, as_of (YYYY-MM-DD), statement_balance, source?, external_ref?, note?, auto_compensate?: boolean }`. Upserts; if `auto_compensate=true` and diff≠0 after insert, immediately posts the compensation transaction in one round-trip. Returns `{ id, computed_balance, diff, status, compensation_transaction_id }`.
- `GET /api/public/account-statements?account_id=…&from=…&to=…` — list.
- `DELETE /api/public/account-statements/:id` — delete.

This is what the AI agent calls. `auto_compensate=true` is the "fire and forget from a bank PDF" path.

## Why this shape

- **Separate table, not a transaction flag**: statements aren't money movements; mixing them into `transactions` muddies reports and reuses fields awkwardly. Keeping them apart mirrors how YNAB, Lunch Money, and GnuCash all model reconciliation.
- **Compensation = real transaction in a dedicated category**: keeps the ledger self-consistent (`sum(transactions) == statement` after compensation) and lets you ask "how much drift have I compensated this year?" by filtering that one category. No special-case math in balance calculations.
- **Any date, not month-end**: schedule is per-account and per-statement, not global.
- **Upsert by `(account, date, source)`**: idempotent for the AI agent — re-running the import doesn't create duplicates.

## Out of scope

- Auto-detecting which past transactions are missing/duplicated (would need transaction-level statement import; you said the AI extraction is separate).
- Multi-currency statements differing from account currency.
- Splitting one compensation across multiple categories.
- Charts of historical drift (easy follow-up once data exists).

## Files

- `supabase/migrations/<ts>_account_statements.sql` — table, RLS, trigger, index.
- `src/lib/finance.ts` — types + 6 helpers above.
- `src/routes/reconcile.tsx` — new page.
- `src/routes/api.public.account-statements.ts` — REST endpoint.
- `src/components/AppShell.tsx` (or wherever nav lives) — add link.
- `src/i18n/index.tsx` — `reconcile.*` keys EN/DE.
- (optional) small "last reconciled" badge in account row.
