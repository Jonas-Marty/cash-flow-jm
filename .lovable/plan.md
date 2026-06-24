# Editing splits & reimbursables, plus split-from-edit

## Root cause of the error

When you save an edited split group, `add.tsx` does:

```ts
await supabase.from("transactions").delete().eq("split_group_id", groupId);
await supabase.from("transactions").insert(newRows);
```

If any slice in the group is reimbursable and already has a row in
`transaction_reimbursements` (your repayment), deleting that slice fires
`cascade_delete_reimbursement_links` → `DELETE FROM transaction_reimbursements`
→ `AFTER DELETE` trigger → `recompute_reimbursable_status(original_id)` →
`UPDATE transactions SET reimbursable_status=... WHERE id = original_id`.

`original_id` is the same row Postgres is currently deleting in the outer
statement, so PG raises `tuple to be deleted was already modified by an
operation triggered by the current command`.

It is not specific to the non‑reimbursable slice — any save on a group that
contains a reimbursable‑with‑links slice fails.

## Implications of editing reimbursables

Reimbursable transactions participate in three pieces of state we have to
keep consistent:

1. `transactions.is_reimbursable` / `reimbursable_status` / counterparty / reason
2. `transaction_reimbursements` rows linking original ↔ settling
3. `reimbursable_writeoff_*` (manual write‑off) fields

Editing rules we need to enforce (with a clear toast when blocked):

- **Original side (the reimbursable expense/income):**
  - Amount may change; trigger already recomputes `reimbursable_status`. OK.
  - `is_reimbursable` may only be turned **off** if no link rows and no write‑off exist; otherwise prompt to first unlink/cancel.
  - Source account, occurred_on, description, note, category, tags: always editable.
  - Type change away from current (e.g. expense → transfer): block while links exist (transfers can't be reimbursable; would also break the split trigger).
- **Settling side (the repayment row):**
  - Amount change must be mirrored into the matching `transaction_reimbursements.amount` so the original's status stays correct. Today we don't, so paying €40 then editing to €30 leaves the original looking settled. Fix: on save, when this tx is a settler, update each link row's amount proportionally (or 1:1 when there is a single link) and re-run `recompute_reimbursable_status` for each affected original.
  - Deleting/unflagging a settler must drop links and recompute (cascade trigger already handles delete; the UI's "edit then unflag" path needs the same treatment).
- **Split slices:**
  - Any slice may be reimbursable independently; per-slice counterparty/reason already supported.
  - Replacing the whole group on save is what causes the trigger collision. See fix below.

## Fix the save error (delete+insert collision)

Switch the split-edit save from "delete all + insert all" to a
**diff/upsert** strategy on `add.tsx`:

```text
existing = editQ.data.group        (rows in DB now, keyed by id)
incoming = slices                  (rows from the form, may have new ids)

to_update = incoming where id ∈ existing.ids
to_insert = incoming where id is new
to_delete = existing.ids minus incoming.ids
```

- `UPDATE` each existing slice in place (amount, category, description, note, is_reimbursable, counterparty, reason). No row is removed, so the cascade trigger never fires for the reimbursable slice and the "tuple already modified" error disappears.
- `INSERT` only newly added slices with the same `split_group_id`.
- `DELETE` removed slices one by one. If a removed slice has rows in `transaction_reimbursements`, surface a confirm dialog ("This slice is linked to a repayment. Removing it will unlink the repayment.") before deleting.

Side benefit: edits to a single slice no longer churn IDs, so attachments,
audit log entries, AI references, and `recurring_occurrences.transaction_id`
keep pointing at the same rows.

## Allow splitting an existing transaction in edit mode

Today `splitMode` is only offered for non-edit, non-transfer. We can lift the
restriction with these guards:

1. **Type must not be `transfer`** (existing constraint, keep).
2. **Not allowed when the transaction is a settler** (`transaction_reimbursements.settling_transaction_id = tx.id` exists). Splitting would make the link ambiguous. Show a hint: "Unlink the repayment first to split this transaction."
3. **Allowed when the transaction is an original reimbursable.** On save we keep the original `tx.id` as one of the slices (preserves existing links) and add new slices in the same `split_group_id`. The kept slice retains `is_reimbursable=true`; new slices default to off but the user can toggle each.
4. **Allowed for ordinary expenses/income.** The single tx is rewritten as slice #1 with the form's amount, and slices 2..N are inserted with a new `split_group_id` shared by all (set on the existing row too — the validation trigger accepts this because user/source/occurred_on/type stay the same).
5. **Attachments** stay on the original slice (which keeps its id). We do not duplicate them.
6. **Recurring linkage**: if `recurring_rule_id` is set on the source row, keep it on slice #1 only; new slices have it null.

UI: in edit mode, show the same split toggle. When toggled on for a
previously single transaction, prefill slice #1 with the current
amount/category/description and add an empty slice #2. The total must equal
the header amount (existing diff indicator). When toggled off for a current
group, require exactly one slice's worth of data and warn that this will
delete the other slices (using the confirm flow above).

## Reimbursement amount drift (settler edits)

Add a small helper invoked from the single-tx save path: when the saved
transaction has rows in `transaction_reimbursements` as the settler, update
those rows' `amount` to match the new tx amount (single-link case) or open a
dialog asking how to redistribute when multiple links exist. Recompute via
the existing `after_reimbursement_link_change` trigger.

## Technical changes summary

- `src/routes/add.tsx`
  - Replace split-edit "delete then insert" block (~lines 702–727) with diff/upsert logic.
  - Drop the `!isEdit` guard on the split toggle; add the settler/transfer guards above.
  - On edit-mode split toggle ON: convert single tx into slices with id preserved for slice #1.
  - On edit-mode split toggle OFF / slice removal of linked slice: show confirm.
  - On single-tx save, mirror amount changes into `transaction_reimbursements` when this tx is a settler.
  - Block `is_reimbursable=false` while links/write-off exist (toast + keep toggle on).
- No schema migration is required for the bug fix or for split-from-edit; existing triggers and constraints already cover the new flows.
- Optional follow-up migration (not in this plan): add a `BEFORE UPDATE` trigger on `transactions` that raises if `is_reimbursable` flips to false while `transaction_reimbursements` rows exist, as a server-side safety net.

## Out of scope

- Changing how reimbursement links are created in the Add screen.
- Bulk re-categorisation tools.
- Editing transfers as splits (still disallowed by trigger).
