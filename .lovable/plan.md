# Open IOUs: incoming debts + Write-off

## Scope
1. Allow `is_reimbursable` on **income** transactions (money I owe back).
2. Add **Write off** action that creates an offsetting transaction in a chosen category and settles the original.
3. Keep existing **Cancel** (status flag, no money moves) unchanged.
4. Rename dashboard card → **Open IOUs** with two grouped sections.
5. Add **Open IOUs** tab to `/pending` (mirrors the dashboard card).

## Data model

Migration:
- Add nullable columns to `transactions`:
  - `reimbursable_writeoff_category_id uuid` (FK→categories)
  - `reimbursable_writeoff_transaction_id uuid` (FK→transactions, ON DELETE SET NULL)
- Update `default_reimbursable_status()` trigger to also clear these two when `is_reimbursable=false`.
- No enum change. `reimbursable_status` stays text with values `open | settled | cancelled` — a write-off ends up `settled` (linked offsetting tx covers the amount), with the two new columns identifying it as a write-off rather than a real refund.

**Direction is derived**, not stored:
- `type='expense' + is_reimbursable` → "Owed to me"
- `type='income'  + is_reimbursable` → "I owe"

## Library (`src/lib/finance.ts`)

- `fetchOpenReimbursables()` already returns both directions once UI allows the flag on income; no query change needed beyond confirming it doesn't filter by `type`.
- Extend `Transaction` type with the two new fields.
- New `writeOffReimbursable(originalTxId, { categoryId, note? })`:
  1. Load original tx (amount, account, type, counterparty).
  2. Insert offsetting tx: opposite `type` (`expense`↔`income`), same `amount`, same `source_account_id`, `occurred_on=today`, `category_id=categoryId`, `description="Write-off: <original desc>"`, `note` carries `#writeoff` tag + optional user note, `is_reimbursable=false`.
  3. Insert `transaction_reimbursements` row linking original ↔ offsetting for full amount (triggers recompute status to `settled`).
  4. Update original: set `reimbursable_writeoff_category_id`, `reimbursable_writeoff_transaction_id`.
- Existing `setReimbursableStatus('cancelled', reason)` unchanged.

## UI

### `src/routes/add.tsx` + `src/routes/edit.$id.tsx`
- Show "Mark as reimbursable" toggle for **both** expense and income.
- Helper text is direction-aware:
  - expense → "Someone will pay you back"
  - income → "You'll need to pay this back"
- `reimburse_for` URL param flow (existing refund shortcut) keeps working; for an "I owe" original it prefills `type=expense` (the repayment).

### Dashboard card → rename file/component to `OpenIOUsCard`
- Two stacked sections inside the same card:
  - **Owed to me** — expense + reimbursable + open (existing data)
  - **I owe**     — income + reimbursable + open (new)
- Each row keeps current actions plus a new **Write off** button.
- Section headings only render when that section has items; card hides entirely when both empty.
- "Add refund" link adapts: for I-owe rows it prefills `type=expense` instead of income.

### Write-off dialog
- Triggered from row action in card and `/pending` tab.
- Fields:
  - **Category** (required) — searchable select over user's categories (no filter; user picks where the loss/gift lands, e.g. "Gifts given", "Bad debt").
  - **Note** (optional) — appended to offsetting tx note.
- Submit calls `writeOffReimbursable`, invalidates queries, toasts.

### `/pending` route
- Add **Open IOUs** tab alongside existing **Pending** / **Rejected**.
- Tab content: re-uses `OpenIOUsCard` body (extract list rendering into a shared component if needed) so dashboard + page stay in sync.
- Nav badge logic unchanged (still only counts unconfirmed pending).

### i18n (`src/i18n/index.tsx`)
- New keys: `iou.title`, `iou.owed_to_me`, `iou.i_owe`, `iou.writeoff.action`, `iou.writeoff.dialog.title`, `iou.writeoff.dialog.body`, `iou.writeoff.category`, `iou.writeoff.note`, `iou.writeoff.help`, `iou.status.written_off`, `add.reimbursable.help.expense`, `add.reimbursable.help.income`.
- Old `dash.reimb.*` keys remain (still referenced inside the card body until renamed); alias unchanged ones.

## Out of scope
- Reporting/analytics on written-off totals.
- Bulk write-off.
- Currency conversion when offsetting in a different currency (offsetting always lands on the same account as the original).
- Undo write-off button (user can manually delete the offsetting tx, which cascades to remove the link and reopens the original — already works via existing triggers).

## Files touched
- `supabase/migrations/<ts>_reimbursable_writeoff.sql` (new)
- `src/lib/finance.ts`
- `src/routes/add.tsx`, `src/routes/edit.$id.tsx`
- `src/components/OpenReimbursementsCard.tsx` → renamed to `OpenIOUsCard.tsx`
- `src/components/IOUWriteOffDialog.tsx` (new)
- `src/components/IOUList.tsx` (new, extracted shared list for card + tab)
- `src/routes/pending.tsx` (add tab)
- `src/routes/index.tsx` (use renamed card)
- `src/i18n/index.tsx`
