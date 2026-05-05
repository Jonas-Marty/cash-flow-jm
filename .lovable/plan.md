# Pending (Unconfirmed) Transactions

A new entity to receive transactions from third-party systems (e.g. an email-parser that extracts credit card charges). Items sit in a "pending" state, are surfaced for the user to review, edit freely, then either **confirm** (creates a real `transactions` row) or **reject** (kept in history).

## Data model

New table `pending_transactions` — fully separate from `transactions`, so balances, budgets, insights, recurring, reimbursements and splits are unaffected until the user confirms.

```sql
CREATE TYPE pending_transaction_status AS ENUM ('pending', 'confirmed', 'rejected');

CREATE TABLE public.pending_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  status pending_transaction_status NOT NULL DEFAULT 'pending',

  -- Mandatory at creation
  source_account_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),

  -- Optional, user fills/edits during confirmation
  type transaction_type NOT NULL DEFAULT 'expense',
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  destination_account_id uuid,
  category_id uuid,
  description text,
  note text,
  destination_amount numeric,

  -- Provenance / context shown during confirmation
  external_source text,        -- e.g. "email-parser", "bank-x"
  external_ref text,            -- optional dedupe key from caller
  external_info text,           -- free-text comment shown to user

  -- Lifecycle
  confirmed_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, external_source, external_ref)  -- nullable cols allow many NULLs
);
```

- RLS: `user_id = auth.uid()` ALL policy (mirrors `transactions`).
- Trigger: `updated_at`, plus the existing audit trigger.
- Trigger: validates that `source_account_id` / `destination_account_id` / `category_id` belong to the same user.

## Public API

New route `src/routes/api.public.pending-transactions.ts`, modelled on the existing `api.public.transactions.ts` (Bearer token auth via `api_tokens`):

- `POST /api/public/pending-transactions`
  - Required: `source_account_id`, `amount`
  - Optional: `type` (default `expense`), `occurred_on` (default today), `destination_account_id`, `category_id`, `description`, `note`, `destination_amount`, `external_source`, `external_ref`, `external_info`
  - Validates account/category ownership (same as the existing endpoint).
  - Returns `201` with the created pending row.
  - Idempotent on `(external_source, external_ref)` when both provided — returns existing row instead of duplicating.
- `GET /api/public/pending-transactions?status=pending` — for the calling system to inspect what's still open.

A new shared schema `src/lib/pendingTransactionSchema.ts` (parallel to `transactionSchema.ts`) — `source_account_id` and `amount` required, everything else optional.

## App UI

### Dashboard (`src/routes/index.tsx`)

- New `PendingConfirmationsCard` placed near `OpenReimbursementsCard`. Shown only when count > 0. Lists pending items grouped by `external_source`, each row: amount, account, date, `external_info` snippet, and "Review" button.

### Nav badge (`src/components/AppShell.tsx`)

- Numeric badge next to the new "Pending" nav item showing count of `status='pending'` rows. Live-updates via Supabase realtime channel on `pending_transactions`.

### Dedicated route `src/routes/pending.tsx`

- Tabs: **Pending** / **Rejected** / (optional) **Confirmed history**.
- Each pending row expands inline into an editor reusing the existing `add.tsx` form fields (extracted into a small `<TransactionFormFields>` component if it isn't already a clean unit — otherwise wrap in a dialog and reuse `add.tsx` logic). User can edit ANY field including amount/account.
- Always-visible "External info" panel showing `external_source`, `external_ref`, `external_info`.
- Three actions:
  - **Confirm** → server fn `confirmPendingTransaction({id, overrides})`: inserts a real `transactions` row with the (possibly edited) values, sets `pending.status='confirmed'`, `confirmed_transaction_id`, `confirmed_at`.
  - **Reject** → opens small dialog asking optional reason; sets `status='rejected'`, `rejected_at`, `reject_reason`. Stays in "Rejected" tab.
  - **Restore** (on rejected rows) → back to `status='pending'`.

### i18n

- Add EN + DE strings for "Pending confirmation", "Confirm", "Reject", "Reject reason", "External info", nav label, etc.

## Server functions

`src/server/pendingTransactions.functions.ts` (new):

- `listPendingTransactions(status)`
- `confirmPendingTransaction({id, overrides})` — RLS via `requireSupabaseAuth`
- `rejectPendingTransaction({id, reason})`
- `restorePendingTransaction({id})`

All operate as the signed-in user (RLS).

## Files touched

- `supabase/migrations/<ts>_pending_transactions.sql` — enum, table, RLS, triggers.
- `src/lib/pendingTransactionSchema.ts` — Zod schemas.
- `src/routes/api.public.pending-transactions.ts` — POST + GET.
- `src/server/pendingTransactions.functions.ts` — confirm/reject/restore/list.
- `src/lib/finance.ts` — types + `fetchPendingTransactions` helper.
- `src/components/PendingConfirmationsCard.tsx` (new).
- `src/routes/pending.tsx` (new).
- `src/routes/index.tsx` — mount the card.
- `src/components/AppShell.tsx` — nav entry + badge.
- `src/i18n/index.tsx` — strings.

## Behavioural notes

- Pending rows do **not** affect any account balance, envelope spend, recurring schedule, or reimbursement totals. They only become "real" on confirm.
- On confirm, if the user filled in reimbursement-related fields, those are written into the new `transactions` row in the same insert (no separate step).
- Splits during confirmation are possible they same way as when creating new transactions. 
- Audit log captures create/confirm/reject/restore via the existing audit trigger on the new table.