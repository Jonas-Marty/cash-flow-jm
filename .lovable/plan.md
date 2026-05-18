## What you already have

Cross-currency transfers are already a first-class concept:
- `transactions.type='transfer'` with `source_account_id` (CHF bank), `destination_account_id` (EUR cash), `amount` (CHF leaving), and `destination_amount` (EUR arriving).
- Implicit FX rate = `destination_amount / amount`. One row, no link bookkeeping needed.

So your **"Example no fee"** (100 € for 93.39 CHF) and **"Example fee hidden in source"** (98.39 CHF → 100 €) work today with zero new code — just one transfer transaction.

The only thing actually missing is a clean way to record the **separately‑charged fee** without making the user add and manually link a second transaction.

## How professional systems handle this

- **GnuCash**: one multi‑split transaction — source leg, destination leg, fee leg to a "Bank Fees" expense account. Balanced books, one entry.
- **YNAB**: transfer + a second manual fee transaction. No link. Simple but messy.
- **Firefly III**: transfer form has an optional "Foreign amount" (= our `destination_amount`) **and** an optional fee field that auto‑creates a linked withdrawal in a chosen expense category.
- **Lunch Money / Copilot**: just a transfer; fee is a separate transaction, no linkage.

Firefly's model maps cleanest onto your existing schema and your "easy entry" goal.

## Recommendation

Treat ATM withdrawal as a **transfer with an optional fee add‑on**, not as a new transaction type. The fee becomes an auto‑created, auto‑linked expense — the user fills one form.

### Data model
- Add to `transactions`:
  - `fee_amount numeric NULL` — fee charged in the source account's currency
  - `fee_transaction_id uuid NULL` (FK→transactions, ON DELETE SET NULL) — the auto‑created fee expense
  - `fee_category_id uuid NULL` (FK→categories) — remembered for edit/undo
- Trigger clears all three on transfers that no longer have a fee, and cascades delete: deleting the transfer also deletes the linked fee expense (or vice versa — pick one direction; I'd cascade transfer → fee).

This mirrors the existing `reimbursable_writeoff_*` pattern you already use, so it's a familiar shape in the codebase.

### Library (`src/lib/finance.ts`)
- Extend transfer create/update path: if `fee_amount > 0` and `fee_category_id` provided, insert a sibling expense (`type='expense'`, same `source_account_id`, same date, `amount=fee_amount`, `category_id=fee_category_id`, description e.g. "ATM fee: <transfer description>") and store its id on the transfer.
- On transfer edit: if fee fields change, update or delete the linked expense.
- On transfer delete: also delete the linked fee expense.

### UI (`src/routes/add.tsx` / `edit.$id.tsx`)
When `type='transfer'` and source/destination currencies differ (already detected via `isCrossCurrency`), show two additional optional fields below `destination_amount`:
- **Fee** (number, source currency)
- **Fee category** (searchable select, defaults to last‑used; remembered per user in settings)

Both empty → behaves exactly like today (no fee row created). One transfer entry, one optional fee — no manual linking, no second navigation.

### Optional: "Cash withdrawal" shortcut
Add a tile/button on the dashboard (or `/add` quick actions) that opens `/add` with:
- `type=transfer` preselected
- `source_account_id` = last bank used
- `destination_account_id` = last cash account used (or only cash account if one exists)
- Cursor in the destination‑amount field (you usually know the EUR you want)

Pure UI shortcut, no schema impact.

## Why not the alternatives

- **"Make it 3 separate transactions with a link group"**: more rows, more screens, no benefit over GnuCash‑style single entry. Your existing `split_group_id` is for splits of one expense across categories, not for grouping heterogeneous tx types.
- **"New `atm_withdrawal` type"**: adds a type just to carry one extra number. The transfer + fee model covers it and stays orthogonal.
- **"Just tell users to bake the fee into the source amount"**: works (your last example), but the fee disappears from category reporting — you can't ever ask "how much did I pay in ATM/FX fees this year?".

## Out of scope
- Multi‑fee transfers (e.g. acquirer fee + network fee). Rare; users can add a second manual expense.
- Per‑account default fee category (could be added later in account settings).
- Reporting widget for total fees paid.

## Files that would change
- `supabase/migrations/<ts>_transfer_fee.sql` (new) — 3 columns + trigger update
- `src/lib/finance.ts` — extend transfer insert/update/delete; extend `Transaction` type
- `src/routes/add.tsx`, `src/routes/edit.$id.tsx` — fee + fee category fields under cross‑currency transfer
- `src/lib/transactionSchema.ts` — allow `fee_amount`, `fee_category_id` on transfers
- `src/i18n/index.tsx` — `add.transfer.fee`, `add.transfer.fee_category`, `add.transfer.fee_help`
- (optional) dashboard quick‑action tile