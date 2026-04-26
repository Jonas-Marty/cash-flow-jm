## Findings vs. current implementation


| Topic                                            | Current state                                                                                                                                                                                                                     | Gap                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Transactions linked to rule**                  | `recurring_occurrences.transaction_id` points to the posted tx, but there is no reverse pointer on `transactions`, and the transaction list/details show no rule badge.                                                           | Add a direct link + UI indicator.                                                           |
| **Preview when creating a rule**                 | Rule dialog has no preview at all.                                                                                                                                                                                                | Add a live preview (past + future dates) inside the dialog.                                 |
| **Past entries when `starts_on` is in the past** | `process_recurring_rules` will eventually create `pending` occurrences back to `starts_on`'s month, but never actual transactions for past months unless `auto_post=true` *and* `effective_on <= today`. The user is never asked. | Ask the user explicitly when saving a rule whose `starts_on` is in the past.                |
| **Future projection entries**                    | Pending occurrences are only generated up to `today + 7 days`. EoM/EoY projection therefore misses most future months.                                                                                                            | Extend horizon for `pending` generation to end of next year (configurable in RPC).          |
| **Delete / archive**                             | `del()` soft-archives the rule and leaves all `pending` occurrences in place — they keep inflating projections.                                                                                                                   | On archive: delete all `pending` (uncommitted) occurrences for that rule. Posted ones stay. |


## Plan

### 1. Database (migration)

- **Add `recurring_rule_id uuid` column to `transactions**` (nullable, no FK action — set null on rule delete is unnecessary because we keep posted txs). Index it.
- **Update `process_recurring_rules**`:
  - Accept an optional `p_horizon_months int default 14` (≈ end of next year worst case).
  - Generate `pending` occurrences for the full horizon, not just `today + 7 days`. Auto-post still only fires when `effective_on <= p_today`.
  - When auto-posting, set `transactions.recurring_rule_id = r.id`.
- **Update `postOccurrence` path** (client): also set `recurring_rule_id` when inserting the manual-post transaction.
- **New RPC `preview_recurring_rule(...)**`: takes the same inputs as a rule (type, amount, day_rule, day_of_month, weekend_adjust, starts_on, ends_on) plus `p_from date, p_to date` and returns a list of `{ due_on, effective_on, in_past boolean }`. Used by the dialog preview without persisting.
- **New RPC `archive_recurring_rule(p_id uuid, p_delete_pending boolean default true)**`:
  - sets `archived = true`,
  - if `p_delete_pending`, deletes all `recurring_occurrences` for the rule with `status = 'pending'`.
- `**reset_occurrence_on_tx_delete` trigger**: keep as is (deleting a posted tx already resets its occurrence to pending).

### 2. `src/lib/finance.ts`

- Extend `Transaction` type with `recurring_rule_id?: string | null`.
- Add `previewRecurringRule(draft, fromISO, toISO)` calling the new RPC.
- Add `archiveRecurringRule(id, deletePending)` calling the new RPC; replace direct `update({archived:true})` calls.
- Update `postOccurrence` to pass `recurring_rule_id: r.id` when inserting the transaction.

### 3. `src/components/RecurringRulesCard.tsx` — rule dialog

- **Preview section** inside the dialog, below the schedule fields:
  - Window: from `starts_on` to `today + 12 months` (capped by `ends_on`).
  - Renders a compact list grouped by year, marking past dates with a muted "past" badge and future dates as "scheduled".
  - Recomputed via `useQuery` with debounced draft inputs; uses `previewRecurringRule` RPC so logic stays consistent with the server.
- **Past-start handling** when saving:
  - If `starts_on < today`, show a confirm step (small inline radio inside the dialog, not a separate modal):
    - **"Don't create past transactions"** (default) — only future occurrences are generated; past ones are skipped entirely (rule's effective generation start = today's month).
    - **"Create past transactions as posted"** — past occurrences up to today are inserted as actual transactions immediately (linked via `recurring_rule_id`); future ones behave normally.
  - Implementation: pass a `p_backfill_mode text` (`'none' | 'post'`) to a small wrapper RPC `apply_recurring_rule_backfill(p_rule_id, p_mode, p_today)` that runs after the rule is inserted/updated, before the normal `process_recurring_rules` call.
- **Delete button**: call `archiveRecurringRule(id, true)`; update confirm text to mention that uncommitted (pending) future entries will be removed and posted transactions kept.

### 4. Transaction list — rule badge

- In `src/routes/transactions.tsx` and the recent-transactions card on the dashboard, when `tx.recurring_rule_id` is set, render a small `Badge` ("Rule" / "Regel") with the rule name (looked up from the `recurring_rules` query already cached). Tooltip: rule name + schedule.
- Optional filter in transactions page: "Source = Rule / Manual / All" (low-cost, since data is already there). Keep behind a small select; skip if it bloats the toolbar.

### 5. i18n keys (en + de)

- `recurring.preview.title`, `recurring.preview.past`, `recurring.preview.future`, `recurring.preview.empty`
- `recurring.backfill.title` ("Start date is in the past")
- `recurring.backfill.none` ("Don't create past transactions")
- `recurring.backfill.post` ("Create past transactions now")
- `recurring.delete_warning` ("Posted transactions are kept. Pending future entries will be removed.")
- `transactions.from_rule` ("From rule: {name}")

### 6. Out of scope

- Editing a rule's amount/schedule retroactively rewriting already-posted transactions — too destructive; the preview makes the new schedule clear, and only future pending occurrences are regenerated.
- Per-occurrence editing (already exists via skip/post override).
- Hard delete of rules — we keep soft-archive so historical posted transactions retain their `recurring_rule_id` reference (the rule row stays, archived=true).

## Files touched

- New migration: `recurring_rule_id` column + index, updated `process_recurring_rules`, new `preview_recurring_rule`, new `archive_recurring_rule`, new `apply_recurring_rule_backfill` RPCs.
- `src/lib/finance.ts` — types + new helpers.
- `src/components/RecurringRulesCard.tsx` — preview panel, backfill choice, archive call.
- `src/routes/transactions.tsx` — rule badge.
- `src/routes/index.tsx` — rule badge in recent transactions.
- `src/i18n/index.tsx` — new keys.