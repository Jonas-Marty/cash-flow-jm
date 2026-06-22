## Goal

Let you mark several transactions as parts of the same real-world purchase (gift card split across two cards, concert ticket + on-site food, IKEA trip paid cash + card). Individual transactions stay first-class and keep counting toward their own categories, budgets, and KPIs exactly as today. The link is a *view* on top, not a new accounting layer.

If only part of a transaction belongs to the group, you split the transaction first (existing/future split flow), then link the resulting slice — the link itself never stores partial amounts.

## How it fits the current model

Building blocks today:

- `transactions` — atomic, always counted.
- `transaction_reimbursements` — 1:1 settled link.
- `transaction_tags` — many-to-many free-form labels.
- `category_reallocations`, Scopes — orthogonal, untouched.

Nothing today expresses "these N transactions are one purchase". Tags are the closest, but they're ad-hoc and have no shared metadata (title, note, planned date).

## Proposed schema

```text
transaction_links
  id, user_id, title, note, kind, planned_on, created_at, updated_at
    kind: 'purchase' | 'event' | 'trip' | 'other'   (drives icon only)

transaction_link_members
  link_id   -> transaction_links.id  (ON DELETE CASCADE)
  transaction_id  -> transactions.id (ON DELETE CASCADE)
  added_at
  PRIMARY KEY (transaction_id)        -- transaction can be in at most ONE link
  UNIQUE (link_id, transaction_id)
```

Key properties:

- A transaction belongs to **at most one** link (per your decision). Enforced by `transaction_id` being the PK.
- No `share_amount` column. If only part of a transaction belongs to the group, the user splits the transaction first and links the resulting slice.
- A link can mix expenses, incomes (refunds), and transfers. We don't try to make it balance.
- Reports keep using `transactions.amount` — the link is never rolled into budgets/KPIs.
- Link total shown in the link sheet = `sum(signed amount)` grouped per currency, same pattern as the rest of the app.

## UI sketch

- Transaction row: small chip when the row is a member of a link → click opens the link sheet.
- Add / Edit transaction: optional "Link to purchase…" combobox (search existing link, or "create new"). Because membership is exclusive, picking another link moves the transaction.
- Link detail sheet: title, kind icon, optional note + planned date, member list, per-currency totals, "add transaction" search, "remove" per row.
- New `/links` index (or a tab on transactions filtered by `link_id`) — minimal list of links with member counts and totals.
- When removing the last member: confirm dialog "This will delete the link '<title>'. Continue?" before performing both the member delete and link delete.

## Problems and how to handle them

1. **Double-counting fear.** Users may think the link total replaces "real" spend. → UI labels the total as "Linked total — accounting unchanged" and the /help page documents the separation (same wording style as the reallocations note we just added).

2. **Exclusive membership friction.** A transaction can only be in one link. → Combobox shows the current link in the field; choosing another asks "Move from '<old>' to '<new>'?". Cheap and explicit.

3. **Deleted transaction.** `ON DELETE CASCADE` removes the membership row. If the link ends up empty, a backend trigger does **not** auto-delete (the user expects the confirmation popup). Instead we surface the empty link with a "Delete empty link" prompt the next time it's opened, and the UI's explicit "remove last member" action does the confirm + delete in one step.

4. **Mixed types in one link.** Refund + purchase + transfer is fine; the link total is `sum(signed amount)` per currency. Transfers (no category) appear in the member list and contribute 0 to the totals to avoid confusion.

5. **Overlap with tags.** Tags stay for ad-hoc filtering. Links are a named bundle with shared metadata and exclusive membership. We can later auto-suggest "create link from all rows sharing tag #X".

6. **Overlap with reimbursements.** Reimbursements are 1:1 IOU settlement. Links are N:M descriptive. Independent; a transaction can be both reimbursed and a link member.

7. **Privacy / RLS.** Both tables scoped to `auth.uid()`. Standard GRANT block, RLS enabled, policies — same template used everywhere.

8. **Performance.** Transaction list needs a "is in a link?" flag per row. One LEFT JOIN on `transaction_link_members` (PK on `transaction_id` makes it cheap). Link detail loads its members in one query.

9. **Webhooks.** Link create/attach is metadata, not a transaction event — skipped in this iteration. Can become `transaction.link.updated` later if needed.

10. **Public API.** Explicitly out of scope per your direction.

11. **Migration of existing data.** None needed — purely additive.

## Build-iteration outline (for after plan approval)

1. Migration: two tables, FKs, RLS, GRANTs, `updated_at` trigger for `transaction_links`.
2. Server functions in `src/utils/links.functions.ts` (list/get/create/update/delete link, attach/detach transaction). All `requireSupabaseAuth`.
3. UI:
   - `LinkSheet` component (detail view, member list, totals, add/remove).
   - "Link to purchase…" combobox embedded in `add.tsx` and `edit.$id.tsx`.
   - Link chip on transaction rows in `transactions.tsx`.
   - `/links` route (simple list).
4. i18n strings (EN + DE) for all new copy.
5. Help page section explaining links vs. tags vs. reimbursements vs. reallocations.

## Out of scope

- Public API endpoints.
- Budgets / KPIs aware of the link.
- Auto-detection of related transactions.
- Webhook events for link changes.
- Shared / cross-user links.
- Building a new transaction-split feature inside this iteration (the plan assumes splitting either already exists or is handled separately).
