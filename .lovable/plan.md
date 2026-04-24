
# Recurring transactions

Add rule-based recurring income & expenses (rent, salary, Deezer share, monthly investments, Rückstellung contributions). Each rule generates real transactions on a schedule; we track which occurrences have been posted so nothing gets duplicated and gaps are visible.

## Concept

A **recurring rule** is a template + schedule. It does *not* itself affect balances — it produces concrete `transactions` rows when an occurrence is "posted". This keeps the rest of the app (account balances, envelopes, history) untouched: posted occurrences are normal transactions, just stamped with the rule that created them.

### Schedule model

Each rule has:
- **Template**: `type` (expense/income/transfer), `amount`, `source_account_id`, `destination_account_id`, `category_id`, `payee`, `note`.
- **Validity range**: `starts_on` (required, first eligible date), `ends_on` (nullable, last eligible date).
- **Frequency**: monthly only in this round (covers all your examples). Designed to extend to weekly/yearly later.
- **Day-of-month rule**: one of
  - **Fixed day** (e.g. 17) — if the chosen day doesn't exist in a month (e.g. 31 in February), clamp to last day.
  - **End of month** — last calendar day.
  - **First of month** — day 1.
- **Weekend adjustment** (only meaningful for fixed/end-of-month): `none` | `before` (move to previous business day) | `after` (move to next business day). "Tax before" → `before`. Public-holiday awareness is out of scope; weekends only.
- **Auto-post**: bool. If true, the system creates the transaction automatically on/after the due date. If false, the user gets a reminder card and posts with one tap.

### Tracking executions

A separate `recurring_occurrences(rule_id, due_on UNIQUE per rule, transaction_id, status, posted_at)` table records every occurrence we've materialised:
- `status = 'pending'` — due date passed (or upcoming within lookahead window) but no transaction yet. Only created for `auto_post = false` rules; auto-post rules skip pending and go straight to posted.
- `status = 'posted'` — `transaction_id` points at the real transaction.
- `status = 'skipped'` — user chose to skip this occurrence (e.g. one-off rent waiver).

UNIQUE(rule_id, due_on) makes the whole pipeline idempotent — running the processor twice on the same day is a no-op.

### Processing pipeline

A single SQL function `process_recurring_rules(p_today DATE)` does all the work, called on every app load (cheap, idempotent):

For each active rule (today between `starts_on` and `coalesce(ends_on, infinity)`):
1. Compute every `due_on` from `max(last occurrence due_on, starts_on)` up to `today`.
2. For each missing `due_on`:
   - Apply weekend adjustment to get `effective_on`.
   - If `auto_post`: insert a `transactions` row using the template with `occurred_on = effective_on`, then insert occurrence with status `posted` linking to it.
   - Else: insert occurrence with status `pending` (no transaction yet).
3. Look ahead **7 days** for `auto_post = false` rules and pre-create `pending` occurrences so the user sees what's about to come due.

The function is called from a tiny `createServerFn` invoked by the dashboard loader. No cron job required; the user opening the app drives processing. (If they don't open the app for a month, the next visit catches up everything in one go.)

### User-driven actions

On the dashboard, a "Upcoming & due" card lists pending occurrences:
- **Post**: turns `pending` → `posted` and creates the underlying transaction (with edit-before-save sheet so the user can tweak amount/payee).
- **Skip**: marks `skipped`.
- **Edit rule**: jumps to the rule editor.

If the user deletes a posted transaction, the linked occurrence flips back to `pending` (FK on delete: `SET NULL` + status update via trigger), so they can re-post or skip cleanly.

## Schema changes

```text
recurring_rules
 ├ id uuid pk
 ├ user_id uuid (nullable, future-auth)
 ├ name text                      -- "Miete", "Lohn", "Deezer share"
 ├ type tx_type                   -- expense | income | transfer
 ├ amount numeric
 ├ source_account_id uuid
 ├ destination_account_id uuid    -- only for transfer
 ├ category_id uuid               -- nullable for transfer
 ├ payee text, note text
 ├ frequency recurring_frequency  -- ENUM 'monthly' (extensible)
 ├ day_rule recurring_day_rule    -- ENUM 'fixed_day' | 'end_of_month' | 'first_of_month'
 ├ day_of_month int               -- 1..31, only for 'fixed_day'
 ├ weekend_adjust weekend_adjust  -- ENUM 'none' | 'before' | 'after'
 ├ starts_on date                 -- inclusive
 ├ ends_on date NULL              -- inclusive
 ├ auto_post bool default true
 ├ archived bool default false
 ├ created_at, updated_at

recurring_occurrences
 ├ id uuid pk
 ├ rule_id uuid → recurring_rules ON DELETE CASCADE
 ├ due_on date                    -- the un-adjusted scheduled date
 ├ effective_on date              -- after weekend adjustment
 ├ status occurrence_status       -- ENUM 'pending' | 'posted' | 'skipped'
 ├ transaction_id uuid → transactions ON DELETE SET NULL
 ├ posted_at timestamptz NULL
 ├ UNIQUE(rule_id, due_on)
```

New SQL:
- `compute_effective_date(p_due date, p_adjust weekend_adjust)` — moves Sat/Sun per rule.
- `compute_due_date(p_month date, p_rule day_rule, p_dom int)` — produces the un-adjusted date for a given month.
- `process_recurring_rules(p_today date)` — main idempotent processor described above.

`transactions` keeps no FK to occurrences (occurrences point at transactions). No changes to existing `transactions` schema.

## UI

**Settings → new "Recurring" card**
- List of rules grouped by Active / Ended / Archived.
- Each row: name · amount · "every 17th, weekend → previous business day" · next due date · auto-post badge.
- Add/Edit dialog: Name, Type, Amount, Account(s), Category, Payee, Note, Validity (start / end), Day rule (fixed day with picker / end-of-month / first-of-month), Weekend adjustment, Auto-post toggle.
- Delete archives the rule (and cascades pending occurrences); posted historical transactions stay.

**Dashboard → new "Upcoming & due" section** above the envelopes section, only shown when there is at least one pending or due occurrence:
- Each row: rule name, due date relative ("in 3 days" / "today" / "3 days late"), amount, Post / Skip buttons. Late items are red.
- Auto-posted occurrences show as a small "auto-posted today" toast-style note on the day they fire (no action needed).

**Add Transaction**: unchanged.

**Translations**: add German + English keys for everything new (recurring.*, dashboard.upcoming.*).

## Architecture document

Update `architecture.md`:
- New section **3.6 Recurring transactions** describing rules, occurrences, the idempotent processor, weekend adjustment, validity range, and how auto-post differs from pending.
- Add `recurring_rules`, `recurring_occurrences` to the ERD in §2.
- Add the new SQL functions to §4.
- Change-log entry dated today.

## Out of scope this round

Weekly/yearly frequencies (schema is ready), public-holiday calendar (weekends only), cron-based posting (driven by app open instead), per-occurrence amount overrides before they're posted (you can edit the resulting transaction afterwards).
