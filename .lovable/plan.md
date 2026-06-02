# Plan: Clarify IOU actions & Pending tabs, fix "Mark as settled" bug

## 1. Explain the 4 IOU actions

Here is what each action does today (from `src/components/OpenIOUsCard.tsx` + `src/lib/finance.ts`):

- **Add repayment** — Opens the Add‑transaction form pre‑filled with the open amount, the counterparty, and a `reimburse_for` link. When you save, the new transaction is linked to the original via `transaction_reimbursements`. A DB trigger (`recompute_reimbursable_status`) then flips the original to `settled` automatically once linked amounts cover the original. Use this when **real money actually moved** (someone paid you back, or you repaid them).
- **Mark as settled** — Directly sets `reimbursable_status = 'settled'` on the original transaction, **without** creating a linked repayment transaction. Use this when the debt was cleared **outside the app** (e.g. cash handover you don't want to book, or a tiny rounding remainder you want to close). It's essentially "I confirm this is done, don't track it any more."
- **Book as loss (write‑off)** — Creates an offsetting transaction in a category you pick (e.g. "Bad debt", "Gifts given"), links it as a reimbursement of the remaining amount, which causes the original to become `settled`. Use this when you're **giving up on collecting / accepting you won't be repaid**, and you want the loss to show up in your budget/reports.
- **Cancel** — Sets `reimbursable_status = 'cancelled'` with an optional reason. Use this when the IOU **shouldn't have been an IOU in the first place** (mis‑flagged, duplicate, voided). Unlike write‑off, no offsetting transaction is created. The recompute trigger explicitly skips cancelled rows so they don't auto‑reopen.

### UI changes for IOUs

In `src/components/OpenIOUsCard.tsx`:

- Add new i18n keys with one‑sentence explanations for each of the 4 actions (EN + DE), e.g. `iou.help.add_repayment`, `iou.help.mark_settled`, `iou.help.writeoff`, `iou.help.cancel`.
- Each action button gets a shadcn `Tooltip` (desktop hover) **and** the same explanation rendered in the existing confirmation/dialog (Cancel dialog already has one; write‑off dialog already has one — extend with the meaning). For "Add repayment" and "Mark as settled" which have no dialog, the tooltip alone isn't enough on mobile, so:
- Add a single small **info icon** (lucide `HelpCircle`) next to the section header ("Money owed to me" / "I owe") that opens a shadcn `Popover` (works on tap) listing all 4 actions with their explanations. This is the mobile‑friendly fallback and also serves as a glossary on desktop.
- Confirmation dialogs already exist for Cancel and Write‑off. **Mark as settled** currently fires immediately with no confirmation — add a small `AlertDialog` ("Mark XYZ as settled? This closes the IOU without recording a repayment.") because it's a destructive‑ish action and matches the recently added skip‑confirmation pattern.

## 2. Explain the Pending tabs

In `src/routes/pending.tsx` the tabs are: **Pending**, **Open IOUs**, **Rejected**, **Confirmed**.

- **Pending** — Imported transactions (e.g. via API / external source) waiting for you to review, edit, and confirm or reject. They are **not** booked yet.
- **Open IOUs** — Already booked transactions you flagged as reimbursable that haven't been settled. Same content as the dashboard "Open IOUs" card.
- **Rejected** — Pending entries you rejected; kept for audit. Can be restored back to Pending.
- **Confirmed** — Pending entries you already confirmed; shown for traceability — the real transaction lives in Transactions.

### UI changes

- Add i18n keys `pending.tab.help.*` with one‑sentence explanations.
- Render a short description line under each active tab (a single line below `TabsList`, e.g. `<p className="text-xs text-muted-foreground">{t('pending.tab.help.' + tab)}</p>`), so the meaning is always visible on any device without requiring hover. Cheaper than per‑tab tooltips and works on touch.

## 3. Investigate "Mark as settled vanished then came back"

What the code does today: `setReimbursableStatus(tx.id, 'settled')` runs an UPDATE on `transactions`, then `qc.invalidateQueries()` refetches. I checked the DB triggers:

- `default_reimbursable_status` only sets a default when status is NULL; it does **not** revert `settled`.
- `recompute_reimbursable_status` only runs from the `transaction_reimbursements` insert/delete trigger, not from a direct status update.
- No other trigger touches `reimbursable_status` on plain UPDATEs.

So a direct status flip to `settled` **should** persist. Likely causes for the symptom the user described:

1. The mutation's `await` resolved but the row UPDATE silently affected 0 rows (RLS or wrong id) — Supabase JS does not throw on 0‑row updates. The optimistic toast then fires, but the row reappears on next refetch.
2. `qc.invalidateQueries()` with no key invalidates everything; the immediate refetch may return cached data if a stale read of `reimbursables/open` happened first. (Unlikely but possible.)

### Fix

In `src/components/OpenIOUsCard.tsx` / `src/lib/finance.ts`:

- Change `setReimbursableStatus` to `.update(...).eq('id', txId).select('id')` and throw if `data.length === 0` (so the toast actually reflects truth).
- In `onMarkSettled` / `onCancelConfirm` / `onWriteOffConfirm`, narrow `qc.invalidateQueries` to the affected keys (`['reimbursables']`, `['reimbursement_links']`, `['transactions']`) and `await` the invalidation, so the UI cannot show a stale empty state.
- After the fix, manually verify in the preview: mark a real IOU as settled, reload, confirm it stays settled. If the row reappears, capture the row id from the toast and inspect `transactions.reimbursable_status` directly to confirm whether the UPDATE landed.

## Technical summary

Files touched:
- `src/components/OpenIOUsCard.tsx` — add `Tooltip` on the 4 action buttons, header `Popover` glossary, confirmation `AlertDialog` for Mark‑as‑settled, awaited narrow invalidations.
- `src/routes/pending.tsx` — add per‑tab description line.
- `src/i18n/translations.ts` — new keys for help texts (EN + DE).
- `src/lib/finance.ts` — make `setReimbursableStatus` verify the row actually updated; same defensive check in `writeOffReimbursable` final update.

No DB migrations needed. No business‑logic change to the IOU lifecycle — only clearer UI + a confirmation step + stricter post‑mutation feedback.
