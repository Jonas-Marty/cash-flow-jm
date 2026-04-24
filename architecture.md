# Architecture

Living technical reference for the Personal Finance app. Update this file in the same change set as any new feature, schema change, or business-rule decision.

## 1. Overview

Mobile-first personal finance tracker with:
- Multiple **accounts** (assets, liabilities) for actual cash location.
- **Envelope budgeting** by month, organised into **groups** of three flavours: *income*, *expense*, *savings*.
- **Transaction history** with hashtag-based ad-hoc filters.
- Single-user mode today; schema is auth-ready (every table has nullable `user_id`).

Stack: TanStack Start v1 (React 19, Vite 7) on Cloudflare Workers, Tailwind v4, Lovable Cloud (Supabase Postgres) for storage.

## 2. Domain model

```
settings ─── (singleton row: currency)

accounts                          category_groups
 ├ id                              ├ id
 ├ name                            ├ name
 ├ type (asset | liability)        ├ kind (income|expense|savings)
 ├ opening_balance                 ├ sort_order
 └ archived                        └ archived
        ▲                                    ▲
        │                                    │
        │                              categories
        │                               ├ id
        │                               ├ name
        │                               ├ allocated_budget   (default/template)
        │                               ├ sort_order
        │                               ├ archived
        │                               ├ group_id ──────────┘
        │                               └ is_savings (cached from group.kind=savings)
        │                                    ▲
        │                                    │
        │                              category_budgets   (per-month history)
        │                               ├ category_id ──────┘
        │                               ├ month  (DATE, day = 1)
        │                               └ amount
        │
 transactions                       transaction_tags
  ├ id                                ├ transaction_id ─┐
  ├ occurred_on                       └ tag             │
  ├ amount  (always positive)                           │
  ├ type (expense|income|transfer)                      │
  ├ source_account_id ──────────────► accounts          │
  ├ destination_account_id (nullable) ► accounts        │
  ├ category_id (nullable) ─────────► categories        │
  ├ payee, note                                         │
  └ id ◄────────────────────────────────────────────────┘

 recurring_rules                    recurring_occurrences
  ├ id                                ├ id
  ├ name                              ├ rule_id ──► recurring_rules
  ├ type (expense|income|transfer)    ├ due_on (un-adjusted)
  ├ amount                            ├ effective_on (after weekend rule)
  ├ source_account_id ──► accounts    ├ status (pending|posted|skipped)
  ├ destination_account_id ► accounts ├ transaction_id ──► transactions (SET NULL)
  ├ category_id ──► categories        ├ posted_at
  ├ payee, note                       └ UNIQUE (rule_id, due_on)
  ├ frequency (monthly)
  ├ day_rule (fixed_day|end_of_month|first_of_month)
  ├ day_of_month
  ├ weekend_adjust (none|before|after)
  ├ starts_on, ends_on (validity range)
  ├ auto_post, archived
```

All tables have `created_at`, `updated_at`, and a nullable `user_id` for future Keycloak/OIDC integration without migration.

## 3. Business rules

### 3.1 Accounts
- **Asset** balance ≈ liquid cash you have. Increases with income/transfer-in, decreases with expense/transfer-out.
- **Liability** balance ≈ amount owed (e.g. credit card outstanding). Stored as a *negative* number on the asset/liability axis: an expense paid by credit card moves the liability balance further negative; a transfer from bank → credit card moves it back toward 0.
- View `account_balances` = `opening_balance + Σ(inflows) − Σ(outflows)` per account.

### 3.2 Transaction effects
| Type | Source acct | Dest acct | Category effect |
|---|---|---|---|
| **Expense** | −amount | — | category `spent_or_received` += amount (for that month) |
| **Income (no category)** | +amount | — | counted in global income |
| **Income (expense category)** = reimbursement | +amount | — | category `spent_or_received` −= amount (reduces month spend) |
| **Income (income category)** | +amount | — | counted toward that income envelope's *received* total |
| **Income (savings category)** = refund | +amount | — | reduces savings envelope spend (raises balance) |
| **Transfer** | −amount | +amount | never touches categories |

Paying off a credit card = Transfer from Asset (bank) → Liability (card).

### 3.3 Envelope flavours (driven by `category_groups.kind`)

| Kind | Behaviour | Variance shown to user |
|---|---|---|
| **income** | `received` = sum of income transactions in the month assigned to this envelope. `allocated` = expected income. | `variance = received − allocated`. Positive = over (green), negative = under (red). |
| **expense** (default) | `spent = Σ(expense.amount) − Σ(income.amount)` for that month. Resets monthly, no rollover. | `variance = allocated − spent`. Bar turns amber at ≥80%, red when over budget. |
| **savings / Rückstellung** | Accumulates across months. Allocations and bookings are independent of monthly spend totals. | Headline = all-time **balance** = Σ(allocations) − Σ(bookings). Negative balance = under-saved (red). Bookings against savings are *excluded* from the month's expense total and never trigger over-budget warnings. |

The savings concept models things like the SBB GA: you allocate ~320 CHF/month into a Bahnabos envelope; when the yearly bill arrives you book it against Bahnabos paid by your credit card. The card balance moves; the month's expense totals stay flat; the savings balance just absorbs the accumulated allocation.

### 3.4 Monthly budget history & rollover-of-allocation

Budgets live in `category_budgets(category_id, month, amount)`. Each row = the budget that applied for that envelope in that calendar month.

- Editing the **current** month's budget overwrites only that month's row. Past months stay frozen → the user can always look up "what was my Lebensmittel budget in March?".
- On first access of a new month, the SQL function `ensure_month_budgets(month)` copies the most recent prior budget per active category into the new month (idempotent). If the category has no prior history, it falls back to `categories.allocated_budget` as a template.
- The `categories.allocated_budget` column is now a *template* used for new months when no prior row exists, and as a sensible default when the UI wants a single number to display in non-month-aware contexts.

The savings balance is unaffected by month boundaries — it is computed from the all-time sums of `category_budgets.amount` and category-assigned transactions.

### 3.5 Tags

`#word` tokens in `transactions.note` are extracted by trigger `sync_transaction_tags` into `transaction_tags(transaction_id, tag)` for indexed filtering.

### 3.6 Recurring transactions

A **recurring rule** is a transaction template + schedule. It does not affect balances directly — it produces concrete `transactions` rows when an occurrence is **posted**. Posted occurrences are normal transactions, just stamped with the rule that created them.

**Schedule model** (per rule):
- Validity range: `starts_on` (required) and `ends_on` (nullable, inclusive).
- Frequency: `monthly` (extensible enum; weekly/yearly out of scope this round).
- `day_rule`: `fixed_day` (with `day_of_month` clamped to month length, e.g. 31 → Feb 28/29), `end_of_month`, or `first_of_month`.
- `weekend_adjust`: `none` | `before` (move Sat→Fri / Sun→Fri) | `after` (Sat→Mon / Sun→Mon). Public-holiday awareness is out of scope.
- `auto_post`: when true, the system creates the transaction automatically once the effective date is reached. When false, the user gets a "pending" reminder card on the dashboard and posts/skips with one tap.

**Tracking executions**: every materialised occurrence lives in `recurring_occurrences(rule_id, due_on, effective_on, status, transaction_id, posted_at)` with `UNIQUE(rule_id, due_on)`. Statuses:
- `pending` — only used for `auto_post = false` rules; means due date is reached or upcoming within the 7-day lookahead window but no transaction exists yet.
- `posted` — `transaction_id` points at the resulting `transactions` row.
- `skipped` — user actively skipped this occurrence.

**Processing pipeline**: `process_recurring_rules(p_today)` is called by the dashboard on every load. For each non-archived rule, it walks month by month from the latest existing occurrence (or `starts_on`) forward to `today` (or `today + 7d` for manual rules), computes each `due_on` and `effective_on`, and either inserts the transaction + posted occurrence (auto) or just a pending occurrence (manual). The `UNIQUE(rule_id, due_on)` constraint plus `ON CONFLICT DO NOTHING` makes the whole thing idempotent — running it twice on the same day is a no-op. No cron required: app open drives processing; if the user skips the app for a month, the next visit catches up everything in one batch.

**Deletion linkage**: `recurring_occurrences.transaction_id` uses `ON DELETE SET NULL`, plus a `BEFORE DELETE` trigger on `transactions` (`reset_occurrence_on_tx_delete`) that flips the linked occurrence back to `pending` so the user can re-post or skip cleanly.

**Archiving**: deleting a rule from the UI sets `archived = true`. Posted historical transactions stay; pending occurrences for archived rules remain in the table but stop being shown / generated.

### 3.7 Shared / split expenses

Shared costs (split rent, joint subscriptions, group dinners) are modelled with the **reimbursement rule** from §3.2 — no new schema, no new transaction type. Pattern:

1. Book the full **expense** against the responsible account and envelope (e.g. 2,400 CHF rent → Bank, category Miete).
2. When the other party reimburses you, book an **income** to the same account with the **same expense (or savings) envelope** as `category_id` (e.g. 1,200 CHF from girlfriend → Bank, category Miete, payee "Girlfriend", note `#shared`).

`category_month_spending` already nets income against the expense envelope, so the envelope shows the user's **actual share** while the bank balance reflects the **real cash movement**. Both rows stay in the transaction history for reconciliation.

For monthly splits, pair two **recurring rules** on the same envelope: one expense rule for the full amount on the payment date, one income rule for the share to be received. The envelope nets correctly each month with no manual bookkeeping.

The Add Transaction screen surfaces a hint under the category select when the user picks `income` and an `expense`/`savings` envelope, explaining the reimbursement effect. Out of scope: multi-party splits with arbitrary fractions, IOU tracking, and explicit row-to-row links between the expense and its reimbursement (the envelope math handles linkage implicitly).

### 3.8 Gift cards & stored-value accounts

Gift cards bought at a discount (e.g. Coop Geschenkkarten via a 4 % employee benefit), prepaid travel cards, and any other stored-value instrument are modelled as **dedicated asset accounts** — not as transactions against an envelope. This keeps the spending power of the card visible at all times and isolates the discount from the budget.

**Loading the card** (e.g. 1,000 CHF card bought for 960 CHF):

1. **Expense** 960 CHF, source = the funding account (e.g. *Migros Cumulus*), category = **none**.
2. **Income** 1,000 CHF, source = the gift-card account (e.g. *Coop Geschenkkarten*), category = **none**.

Net effect: funding account −960, gift-card account +1,000, net worth +40 (the discount surfaces as a balance gain, not as budget income), no envelope is touched.

**Spending from the card**: a normal expense with `source = Coop Geschenkkarten` and the appropriate envelope (e.g. Lebensmittel). The full sticker price hits the envelope; the card balance ticks down. When the card hits zero, stop using it.

**Linking the two load legs**: tag both transactions with `#giftcard-load` (or `#giftcard-load-YYYY-MM` for a specific batch). The existing `transaction_tags` extraction makes load pairs filterable on the Transactions page — no schema link needed, consistent with §3.7's implicit-linkage choice. A `transfer` cannot be used because the two legs have different amounts (960 ≠ 1000).

Out of scope: a formal `transaction_links` table, automatic profit/discount reporting, expiry tracking, and per-card serial numbers.

### 3.9 Smart suggestions on Add Transaction

The Add screen surfaces ranked suggestions that prefill the form (amount, payee, source account, category, note). The architecture is provider-based so new sources — AI inference (Lovable AI on payee/amount), receipt OCR, bank-statement matching — can plug in without touching the UI.

**Provider model** (`src/lib/suggestions/`):
- `types.ts` — `Suggestion` (id, score 0..1, label, sublabel, source tag, partial `TransactionDraft`), `SuggestionContext` (everything the user has typed/picked plus cached transactions/accounts/categories), `SuggestionProvider`.
- `registry.ts` — array of enabled providers + `runSuggestions(ctx)` orchestrator: parallel fan-out, dedupe by `(payee, amount-bucket, category)`, drop below `MIN_SCORE = 0.4`, return top 5 by score.
- `useSuggestions(ctx)` — debounced 150 ms React hook returning `{ suggestions }`.

**Round 1 providers**:
- `historyProvider` — scores last-180-day transactions of the same `type` against the current draft. Inputs: amount match (exact 1.0 / ±5 % 0.7 / ±20 % 0.3), payee match (exact 0.8 / prefix 0.5 / contains 0.3), recency boost (exp decay, 30-day half-life, max +0.3), frequency boost (log of group count, max +0.2), small day-of-month bonus. Groups identical drafts so "Lunch · 12.50 (3×)" appears once.
- `payeeProvider` — payee-substring autocomplete; returns lower-confidence suggestions filling payee + last-used category. Replaces the previous plain `<datalist>` (kept as a graceful fallback).

**Sticky-typing rule**: tapping a suggestion fills only fields the user hasn't touched. A "Use all fields" link inside each chip overrides this. After applying, an "Filled from past transaction · Undo" banner restores the prior values. `touched` is tracked per field on the Add route.

Other smoothness polish (same registry-free files, all in `src/components/`):
- `QuickAmountChips` — most-frequent past amounts for the current type; one-tap to fill.
- `TagChips` — top 6 tags from history; tap to append `#tag` to the note.
- `DateShortcuts` — Today / Yesterday / Last weekend chips above the calendar.

Out of scope: AI-based category inference, OCR receipts, bank-import matching, learned per-user weights, suggestions for transfers.

## 4. SQL surface

| Object | Type | Purpose |
|---|---|---|
| `account_balances` | view | Per-account computed balance. |
| `category_month_spending(p_month DATE)` | function | Per-envelope row for the given month: `allocated`, `spent_or_received`, `variance`, plus group metadata (`group_id`, `group_name`, `kind`, `is_savings`, sort orders). |
| `category_savings_balance` | view | All-time `allocated_total`, `spent_total`, `balance` for every `is_savings = true` category. |
| `ensure_month_budgets(p_month DATE)` | function | Idempotently copies the most recent prior budget into the given month for every active category. Called by the UI before reading month rows. |
| `sync_transaction_tags()` | trigger function | Re-derives `transaction_tags` from the note on insert/update. |
| `update_updated_at_column()` | trigger function | Sets `updated_at = now()` on update; attached to all mutable tables. |
| `compute_due_date(p_month, p_rule, p_dom)` | function | Produces the un-adjusted scheduled date for a recurring rule in a given month. Clamps fixed day to month length. |
| `compute_effective_date(p_due, p_adjust)` | function | Applies the weekend adjustment (`before` / `after` / `none`). |
| `process_recurring_rules(p_today)` | function | Idempotent recurring-rule processor. Catches up missed occurrences, auto-posts where configured, and creates pending occurrences for manual rules within a 7-day lookahead. |
| `reset_occurrence_on_tx_delete()` | trigger function | When a transaction backing an occurrence is deleted, flips the occurrence back to `pending`. |

RLS: every public table has a permissive `open_all` policy (single-user mode). When auth is added these become `auth.uid() = user_id`.

## 5. UI route map

| Route | File | Purpose |
|---|---|---|
| `/` | `src/routes/index.tsx` | Dashboard: net worth, accounts, envelopes grouped by `category_groups`, recent transactions. |
| `/add` | `src/routes/add.tsx` | Numpad-style transaction entry. |
| `/transactions` | `src/routes/transactions.tsx` | Filterable list (account, category, type, tag, date, payee). |
| `/envelopes` | `src/routes/envelopes.tsx` | Per-month envelope detail with month picker, grouped sections, per-envelope transaction list. |
| `/settings` | `src/routes/settings.tsx` | Currency, accounts, groups, envelopes (with group + savings toggle), monthly budget edits. |

Shared shell: `src/components/AppShell.tsx`. Data helpers: `src/lib/finance.ts`. Supabase client: `src/integrations/supabase/client.ts` (auto-generated, do not edit).

## 6. Future auth

Every public table carries a nullable `user_id UUID`. To plug in Keycloak/OIDC:
1. Add an auth proxy that mints Supabase JWTs with `sub` = Keycloak subject.
2. Backfill `user_id` on existing rows.
3. Replace the `open_all` RLS policies with `USING (user_id = auth.uid())` and `WITH CHECK (user_id = auth.uid())`.
4. Wrap inserts in app code with the resolved user id (or a `before insert` trigger that fills it from `auth.uid()`).

No schema change required for the switch.

## 7. Change log

### 2026-04-24 — Gift cards & stored-value accounts
- Documented the gift-card pattern as new §3.8: dedicated asset account, two-leg load (expense + income with no category), tag convention `#giftcard-load`, normal envelope-bound spends thereafter. No schema changes.
- Settings → Accounts now shows a hint suggesting an asset account for gift cards / stored-value.
- New i18n key: `settings.accounts.asset_hint` (DE + EN).

### 2026-04-24 — Shared / split expenses pattern
- Documented the reimbursement-rule pattern for shared costs (split rent, joint subscriptions) as new §3.7. No schema changes.
- Add Transaction screen now shows a contextual hint when income is posted against an expense or savings envelope, explaining the reimbursement effect.
- New i18n keys: `add.reimbursement_hint`, `add.reimbursement_hint.savings` (DE + EN).

### 2026-04-24 — Recurring transactions
- Added `recurring_rules` and `recurring_occurrences` tables with enums `recurring_frequency`, `recurring_day_rule`, `weekend_adjust`, `occurrence_status`.
- Added SQL functions `compute_due_date`, `compute_effective_date`, `process_recurring_rules` plus the `reset_occurrence_on_tx_delete` trigger on `transactions`.
- Dashboard runs `process_recurring_rules(today)` on mount and shows an **Upcoming & due** card listing pending occurrences with Post / Skip actions. Late items render in red.
- Settings page gained a **Recurring transactions** card with Add / Edit dialog (template + schedule + validity range + auto-post toggle) and Active / Ended / Archived sections.
- German + English translations added under `recurring.*` and `dashboard.upcoming.*`.
- Deleting a rule archives it (posted history retained); deleting a backing transaction flips its occurrence back to `pending` automatically.

### 2026-04-23 — Internationalization (i18n)
- Added `settings.language` column (default `'de'`).
- Added `src/i18n/index.tsx` with `I18nProvider`, `useI18n` hook, and German + English dictionaries. New languages plug in by extending the `Lang` union and `dicts` map.
- Root layout now reads the language from settings and provides translation context + a date-fns `Locale` (used by all `format(...)` calls and the calendar).
- All user-facing strings across AppShell, Dashboard, Add, Transactions, Envelopes, and Settings routes use `t(key)` / `t(key, vars)`.
- Settings page gained a Language picker (Deutsch / English).
- App default is German.

### 2026-04-23 — Groups, monthly budget history, savings envelopes, income variance
- Added `category_groups` table with `kind` enum (`income | expense | savings`).
- Added `categories.group_id` and `categories.is_savings`.
- Added `category_budgets(category_id, month, amount)` storing per-month budget history; current month backfilled from existing `allocated_budget`.
- Replaced view `category_month_spending` with function `category_month_spending(p_month)` returning per-month rows including group metadata, variance, and `is_savings`.
- Added view `category_savings_balance` for all-time savings balances.
- Added function `ensure_month_budgets(month)` for idempotent copy-forward.
- Income envelopes now show variance (over = green, under = red).
- Savings envelopes display the all-time balance instead of a progress bar; bookings against them don't affect monthly expense totals or trigger over-budget warnings.
- Settings page gained a Groups CRUD card and a Group dropdown per envelope.
- Add Transaction shows a small `Rückstellung` / `Income` badge in the category dropdown.

### Earlier — Milestone 1 baseline
- Accounts, envelopes (single allocated_budget per category), transactions with hashtag tagging, single-currency settings, basic dashboard / add / transactions / envelopes / settings routes.