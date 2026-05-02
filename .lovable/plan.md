# Reimbursable / Lend-out Transaction Tracking

## Goal

Track expenses that live outside your normal budget because someone owes you back the money (employer reimbursements, money lent to friends, shared train tickets). You should always see what's still open, mark items as settled when the money arrives, and easily link the incoming refund to the original expense(s).

## Conceptual model

I think your instinct is right and the current data model needs only a small extension. Two concepts:

1. **A flag on a transaction**: "this is a reimbursable / I expect this back".
2. **A link from the settling transaction(s) back to the original**: many-to-one (one income can settle several expenses; one big expense could in theory be partially refunded by several incomes — both directions handled).

Splits already work: a single trip to the office supply store with 3 work items + 1 personal item can be entered as a split — each row gets its own reimbursable flag and "no category" assignment, so they stay out of your budget individually but can still each be linked.

### Why a flag + link table (not a new "loans" entity)

- Reimbursables ARE just transactions. They affect account balance the same way. A separate entity would force duplicate UIs.
- A link table (rather than a single `reimbursed_by_transaction_id` column) supports the M:N case naturally (e.g. employer pays you one lump sum at month-end covering 5 receipts).

## Data model changes

```sql
-- Mark an expense (or income) as expected to be reimbursed / lent out
ALTER TABLE transactions
  ADD COLUMN is_reimbursable boolean NOT NULL DEFAULT false,
  ADD COLUMN reimbursable_status text,         -- null | 'open' | 'settled' | 'cancelled'
  ADD COLUMN reimbursable_counterparty text,   -- e.g. "Employer", "Anna"
  ADD COLUMN reimbursable_reason text;         -- free text: why you'll get it back

-- Link a settling transaction (income) to the original expense(s)
CREATE TABLE transaction_reimbursements (
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL,                       -- own RLS
  original_transaction_id uuid NOT NULL,       -- the reimbursable expense
  settling_transaction_id uuid NOT NULL,       -- the income that pays it back
  amount numeric NOT NULL,                     -- portion of settling tx applied
  created_at timestamptz default now(),
  UNIQUE (original_transaction_id, settling_transaction_id)
);
```

- RLS: own rows only (mirroring `transactions`).
- Trigger: when a row is inserted/deleted, recompute the original transaction's `reimbursable_status`:
  - sum of linked amounts >= original amount → `settled`
  - 0 < sum < original → stays `open` (partial)
  - 0 → `open`
- Trigger: deleting a settling transaction cascades the link rows.
- `is_reimbursable=true` defaults `reimbursable_status='open'` on insert.

Splits work as today: each split row can independently be flagged reimbursable and linked.

## UI changes

### Add / Edit transaction (`src/routes/add.tsx`)

- New section "Reimbursement" (collapsible, off by default):
  - Toggle: "I'll get this money back"
  - When on: counterparty (free text + autocomplete from past values), reason (free text).
  - Works per-split row when in split mode.
- **Auto-link suggestion**: when adding an **income** transaction whose amount matches one or  more open reimbursables (exact, or sum of a small subset), show an info banner above the save buttons:
  > "This matches 3 open reimbursables totalling CHF 124.50. Link them?"
  > with a checklist (preselected) to confirm. Saving inserts the income tx, then writes the `transaction_reimbursements` rows.
- The transaction preview shows a small "Reimbursable · Open" badge when the flag is on.

### Dashboard (`src/routes/index.tsx`)

- New `OpenReimbursementsCard` (placed near `UpcomingCard`):
  - Lists all `is_reimbursable=true AND reimbursable_status='open'` transactions, grouped by counterparty, with running totals.
  - Per-row actions:
    - "Mark settled" (manual override, no income tx)
    - "Add refund" → jumps to `/add` prefilled: type=income, amount=remaining, source=same account, counterparty/reason copied, and the original tx pre-selected in the link picker.
    - Click row → opens edit.
  - Hidden when nothing is open.

### Transactions list (`src/routes/transactions.tsx`)

- Reimbursable rows get a small badge ("Open" amber / "Settled" green / "Cancelled" muted).
- Filter chip: "Reimbursable" with sub-options open / settled / all.
- Row expand shows linked settling transaction(s) and vice versa.

### Insights

- No changes for v1. (Could later add "Outstanding receivables" KPI.)

## Edge cases

- **Partial refunds**: handled by `amount` on the link row; status flips to `settled` only when fully covered.
- **Over-refunds** (refund > expense): allowed; surplus is just income, status `settled`.
- **Editing the original amount** after it was settled: trigger re-evaluates status.
- **Splits**: each split row independently flagged & linked. Auto-link suggestion considers individual split rows, not group totals.
- **Cross-currency**: v1 only suggests matches in the same currency as the source account; manual link UI allows any.

## Files touched

- New migration: schema + triggers above.
- `src/lib/finance.ts`: extend `Transaction` type; helpers `fetchOpenReimbursables`, `linkReimbursement`, `unlinkReimbursement`, `markReimbursableSettled`.
- `src/routes/add.tsx`: reimbursement section, auto-link banner, link insertion on save, prefill via query params (`?reimburse_for=<txId>`).
- `src/components/OpenReimbursementsCard.tsx` (new) — used by `src/routes/index.tsx`.
- `src/routes/transactions.tsx`: badge, filter, expand panel.
- `src/components/TransactionPreview` area in add.tsx: badge.
- `src/i18n/index.tsx`: en + de strings.

## Open questions for you (will ask before implementing if you want)

1. Should a reimbursable expense be **excluded from envelope spending** automatically (i.e. force `category_id = null`), or do you want to keep choosing? Today the existing reimbursement-hint copy suggests "no category" is the convention — I'd default to that and just warn if a category is set. --> that will work
2. For the dashboard card: group by **counterparty** (Employer / Anna / …) or just a flat chronological list? --> yes group by counterparty
3. Status values — do you want a `cancelled` state (you decided you won't get it back after all), or only open/settled? --> yes add a cancelled (with option to add reason)