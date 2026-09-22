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
         │                               └ rolls_over (per-envelope behaviour switch; see §3.3)
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

### 3.3 Envelope flavours: `category_groups.kind` vs `categories.rolls_over`

Two coordinated fields classify an envelope. They have **distinct, non-overlapping jobs**:

| Field | Job |
|---|---|
| `category_groups.kind` ∈ {`income`, `expense`, `savings`} | **Taxonomy + default for new envelopes.** Drives the section header on the envelopes screen, and pre-selects the savings toggle when an envelope is created inside that group. Does **not** by itself decide a single envelope's accounting behaviour. |
| `categories.rolls_over` (boolean) | **Per-envelope behaviour switch.** Decides what happens to the month-end *remainder*, not whether the envelope is funded — both kinds are allocated every month. True: the remainder carries forward and the month's cost is the allocation rather than the spend. False: the remainder (or overspend) sweeps to the sweep target and the envelope starts fresh. |

#### Effective kind (the one truth)

Both UI and SQL derive the per-row **effective kind** identically:

```
effective_kind =
  rolls_over                       ? 'savings'
  : group.kind === 'income'        ? 'income'
  : 'expense'                      // includes ungrouped non-savings envelopes
```

This rule lives in `category_month_spending(p_month)` (returned as the `kind` column) and is reused by the envelopes screen and the Add transaction form. The client never recomputes it from `rolls_over + group.kind` independently.

#### Behaviour table (effective kind)

| Effective kind | Behaviour | Variance shown to user |
|---|---|---|
| **income** | `received` = sum of income transactions in the month assigned to this envelope. `allocated` = expected income. | `variance = received − allocated`. Positive = over (green), negative = under (red). |
| **expense** | `spent = Σ(expense.amount) − Σ(income.amount)` for that month. Resets monthly, no rollover. | `variance = allocated − spent`. Bar turns amber at ≥80%, red when over budget. |
| **savings / Rückstellung** (`rolls_over`) | Allocated monthly like any other envelope, but the remainder carries forward instead of being swept. | Headline = **balance** from `category_savings_balance(as_of)` = opening + Σ allocations − Σ bookings ± reallocations + sweeps received. Negative = under-saved (red). Bookings are *excluded* from the month's expense total: the month's cost is the allocation, so the yearly bill the envelope was saving for does not spike the month it lands in. |

The savings concept models things like the SBB GA: you allocate ~320 CHF/month into a Bahnabo envelope; when the yearly bill arrives you book it against Bahnabo paid by your credit card. The card balance moves; the month's expense totals stay flat; the envelope balance absorbs the accumulated allocation.

#### 3.3.1 The balance-sheet identity

Every franc in an account belongs to exactly one envelope. `envelope_reconciliation(p_as_of)`
returns each term and a `residual` that **must read 0.00 at any date**:

```
accounts_total = rollover_total          -- envelopes that carry forward, scopes included
               + expense_open            -- this month's remainder on envelopes that reset
               + income_open             -- income received this month minus income planned
               + outstanding_reimbursements
               + unallocated             -- unassigned openings, uncategorised flow, FX, plan gap
               + residual                -- 0.00
```

Two pieces make it hold *continuously* rather than only at month ends:

- **Income envelopes are conduits.** An income envelope holds `received − allocated`, so it
  starts each month owing the plan (−7,144.47 on the 1st) and settles when the salary lands on
  the 25th. Without this, envelopes funded on day 1 would exceed the accounts until payday.
- **Sweeps are computed, never written.** Once a month is fully elapsed, each non-rolling
  envelope's `allocated − spent` (or, for income, `received − allocated`) is credited to its
  sweep target at read time. Editing a past transaction changes the sweep on the next read;
  there is no month-close job and nothing to repair.

`opening_balance` on a rolling envelope is the one piece of stored state that is not derived —
it is a statement about what the envelope held before the app existed. Whatever is not yet
assigned sits in `unallocated`, using the same predicate the balance function counts, so
assigning it moves money between terms and never changes the residual.

#### Allowed / divergent combinations

`rolls_over` can disagree with the parent group's `kind`. This is intentional: a single "Holiday fund" envelope can sit inside an otherwise expense-flavoured "Variable" group without forcing the user to spin up a sibling savings group. The Settings UI flags such rows with a small "behaviour differs from group" badge so the divergence stays visible. The synthetic group header on the envelopes screen still uses the parent group's name; only the row math follows the row's own effective kind.

| `group.kind` | `rolls_over` | Effective kind | Notes |
|---|---|---|---|
| `expense` | false | expense | default case |
| `expense` | true  | savings | standalone savings pot inside an expense group (badge in Settings) |
| `income`  | false | income | default income envelope |
| `income`  | true  | savings | rare; possible (e.g. "set aside 10% of salary"); badge shown |
| `savings` | true  | savings | default when the user picked a savings-flavoured group |
| `savings` | false | expense | unusual; allowed; badge shown |
| *no group* | false | expense | ungrouped envelope, monthly expense behaviour |
| *no group* | true  | savings | standalone savings pot, no parent group |

#### Why both fields exist (and why we don't collapse them)

- **Why `kind` survives:** users want a stable taxonomy for headers and a default for new envelopes. Removing it would force every envelope creation to ask "what flavour?" individually.
- **Why `rolls_over` survives:** standalone savings envelopes (no group) need *some* per-row marker, and users sometimes want a single savings pot inside a non-savings group.
- **Why we don't add an `is_income` per category:** there is no concrete use case for "one income envelope inside an expense group". Income behaviour stays group-derived. If that ever changes, it generalises cleanly to a per-category enum without altering the existing `rolls_over` semantics.

#### Invariants enforced in the database

- `category_month_spending` returns the effective kind directly, so any other consumer (RPC caller, public API) sees the same answer.
- A trigger (`cleanup_budgets_on_savings_flip`) deletes monthly `category_budgets` rows when a category is flipped to `rolls_over = true`. Savings envelopes don't use them and stale rows would otherwise drift the UI.
- The Settings UI auto-defaults `rolls_over` to match the chosen group's `kind` on envelope creation, but never auto-clears it when the group changes later (so a savings envelope cannot be silently demoted).

### 3.4 Monthly budget history & rollover-of-allocation

Budgets live in `category_budgets(category_id, month, amount)`. Each row = the budget that applied for that envelope in that calendar month.

- **Any month is editable**, past included. `set_category_budget(category_id, month, amount, scope)` is the only writer; `scope` is `month` (that month alone — a correction) or `forward` (that month and every later row, plus `categories.allocated_budget`). `forward` updates existing later rows rather than deleting them for copy-forward to regenerate: deletion made the result depend on which months the user had happened to browse, since viewing a month materialises it.
- Past months are therefore **not** frozen. Editing one is not cosmetic — per §3.3.1 sweeps are computed at read time, so changing an elapsed month's budget changes that month's sweep and every savings balance since. There is nothing to repair, which is what makes it cheap; the RPC writes an `audit_logs` entry when the edited month has fully elapsed so the change leaves a trace.
- Scopes are rejected by the RPC, matching `ensure_month_budgets`: they are funded from their funding envelope at close and take no part in the monthly plan.
- `ensure_month_budgets(month)` **fills every gap up to the current month**, idempotently. Each missing month inherits from *its own* nearest prior row — so an interior gap gets what applied at the time, not today's figure — falling back to `categories.allocated_budget` where the envelope has no history at all. The range is bounded by each envelope's own first budgeted month, so a category created last week does not acquire a year of rows. Every envelope except scopes gets one, rolling ones included, since that allocation is the money they live on.
- **Gaps in elapsed months are a correctness bug, not cosmetics.** `category_savings_balance` sums allocations over `cb.month <= p_as_of` and computes each elapsed month's sweep from `allocated - spent`; a missing row therefore contributes neither, understating every rolling envelope's balance and pushing `envelope_reconciliation`'s residual off zero. Away from 22 July until 3 December, the old one-month-at-a-time seeding left August through November missing.
- **Nothing is ever materialised past the current month.** Looking at a month is not deciding it, and the budget grid shows twelve at once. The cap lives in the function, so `ensure_month_budgets` is safe to call with any month and there is one rule rather than a second client-side copy of it. A future month with no row is *undecided*; the grid renders what it would inherit in italics so a blank is never read as zero.
- Both views resolve a rowless month the same way. `category_month_spending` used to COALESCE straight to `allocated_budget`, which disagreed with the grid's copy-forward for future months; it now takes the nearest prior row first.
- `set_category_budgets_bulk(p_edits jsonb)` applies many cells as one transaction and one audit entry — fill-right and copy-a-column are one decision each, not twelve. It enforces the same three guards as the single-cell RPC, before any write, so a bad batch is rejected whole. An edit whose `amount` is JSON `null` **clears** the cell: undo has to be able to restore a month to undecided, and writing back the value it happened to inherit would decide it.
- The `categories.allocated_budget` column is now a *template* used for new months when no prior row exists, and as a sensible default when the UI wants a single number to display in non-month-aware contexts.

A rolling envelope's balance is unaffected by month boundaries: it is `opening_balance` plus every `category_budgets.amount` up to the date, less category-assigned transactions, plus reallocations and swept leftovers. Scopes are excluded from allocation — they are funded from their funding envelope when they close.

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

**Processing pipeline**: `process_recurring_rules(p_today)` is called by the dashboard on every load. It runs in two passes:

1. **Promotion pass** — scans existing `pending` occurrences whose `effective_on <= p_today` for rules that are currently `auto_post = true` and `is_variable_amount = false`, creates the matching `transactions` row, and flips the occurrence to `posted`. This catches occurrences that were materialised as `pending` earlier — either by the 14-month look-ahead window (so they sit as pending until their effective date arrives) or because the rule was switched to auto-post **after** the occurrence already existed. Without this pass, a manual→auto flip would leave old pendings untouched until the user posted them by hand.
2. **Materialisation pass** — for each non-archived rule, walks month by month from the latest existing occurrence (or `starts_on`) forward to the 14-month horizon, computes each `due_on` / `effective_on`, and either inserts the transaction + `posted` occurrence (when auto-post + fixed-amount + already due) or a `pending` occurrence otherwise.

The `UNIQUE(rule_id, due_on)` constraint plus `ON CONFLICT DO NOTHING` makes both passes idempotent — running them twice on the same day is a no-op. **No cron required**: app open drives processing; if the user skips the app for a month, the next visit catches up everything in one batch. See §10 for an optional cron-based alternative if you want auto-posts to land without an app visit.

**Deletion linkage**: `recurring_occurrences.transaction_id` uses `ON DELETE SET NULL`, plus a `BEFORE DELETE` trigger on `transactions` (`reset_occurrence_on_tx_delete`) that flips the linked occurrence back to `pending` so the user can re-post or skip cleanly.

**Archiving**: deleting a rule from the UI sets `archived = true`. Posted historical transactions stay; pending occurrences for archived rules remain in the table but stop being shown / generated.

**Manual-post editing & description placeholders**: rules with `auto_post = false` open a post dialog (`PostOccurrenceDialog`) instead of one-tap posting. The user can adjust `occurred_on` and rewrite `description` / `note` before the transaction is created. Both fields support template interpolation via `src/lib/placeholders.ts` using the syntax `${token}` or `${token:format}` (with `$$` escaping a literal `$`).

Available tokens:
- **Date tokens** (formatted with date-fns syntax; `ddd`/`dddd` are aliased to `EEE`/`EEEE`): `date` (= effective `occurred_on`), `dueDate` (pre-weekend-shift), `prevDate` (previous occurrence's effective date, or `starts_on` for the first), `nextDate`, `periodStart` (= `prevDate + 1 day`), `periodEnd` (= `date`), `today`.
- **Numeric tokens** (with optional `:00` zero-pad width): `runNumber`, `quarter`, `semester`, `trimester`, `weekOfYear`, `monthOfYear`, `year`.

Period semantics derive purely from cadence: `periodStart = prevDate + 1d`, `periodEnd = date`. This works deterministically for any frequency without introducing a separate "billing period" entity.

The **format locale** for month/day names lives in `settings.format_locale` (currently `de` | `en`) and is independent of the UI language — so a German-UI user can render `MMM yyyy` as `May 2026` for invoices to English-speaking counterparts.

**`MMM` short months never carry a trailing period.** date-fns/locale data appends `.` for some German abbreviations (`Jan.`, `Feb.`, `Sep.`); `src/lib/placeholders.ts` strips that single trailing dot from each `MMM` rendering so output stays neutral across locales. Users who want a period can write `${date:MMM}.` literally. `MMMM` (long month name) is unaffected.

Resolution happens client-side at post time and the **already-resolved** strings are written to `transactions`. There is no template re-render later — the saved transaction is the single source of truth and won't drift if the rule is edited or deleted afterwards. The recurring-rule edit dialog also resolves placeholders inline next to each preview row so users can validate the output before saving.

**Why the model still holds (vs. promoting recurring rules to a "PlannedExpense" entity)**: the cadence + day rule + weekend adjust still uniquely produce due dates; placeholders only affect the *content* of the resulting transaction, not when it fires. Variable-amount rules already broke the "fixed" assumption on the amount axis — editable date + description on manual post is the same axis (fixed schedule, variable content). Auto-post rules remain truly fixed and use the raw `description` verbatim (server-side placeholder resolution is a follow-up).

The model would need to be split if (a) a single rule needed multiple bills per period, or (b) the period were decoupled from the cadence (e.g. post in May for Jan–Mar). Neither is on the table today.

**Bill proposals** (`src/lib/recurringProposal.ts`, `/api/public/recurring-proposals`): an outside system that sees the bill — FinReader, reading the phone's notifications — may propose the **amount and date** of a not-yet-posted occurrence. Nothing is posted; the proposal lives in `recurring_occurrences.proposed_amount`, `proposed_occurred_on`, `proposal_source`, `proposal_ref`, `proposal_info`, `proposed_at` (all set or all NULL) and only pre-fills what the user sees:

- `UpcomingCard` fills the amount field and shows "Bill 15.09. · CHF 2'691.72 from FinReader"; `PostOccurrenceDialog` starts with the proposed amount and date, says who provided them and when, shows the raw notification text, warns when the amount is outside ½×–2× of `estimated_amount`, and offers "Discard suggestion".
- **Variable-amount rules only.** A fixed amount is the user's own statement of what the bill costs; the API answers 422 `fixed_amount`.
- **Which occurrence:** the first one, of any status, scheduled no more than 7 days before the bill's date and no further ahead than one interval. Any status on purpose: when that one is already **posted**, the bill came late and is refused with 409 `already_posted` plus the `transaction_id`, so the phone can send the user to edit that transaction by hand — it is never moved to next month. Skipped → 409 `skipped`.
- A newer proposal on the same pending occurrence replaces the older one (a corrected bill). The same `(external_source, external_ref)` again is idempotent.
- The columns stay after posting: they record where the transaction's numbers came from, and let the phone look up what became of its proposal.
- Saving a rule deletes and regenerates its pending occurrences; `reattachProposals` puts each proposal back on the occurrence it now belongs to (dropped if the rule got a fixed amount).

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

### 3.10 Entity visuals & quick-pick chips

Source/destination accounts and categories on Add Transaction render as **chips** (icon/emoji/uploaded image + name) instead of dropdowns. Goal: zero-scroll, one-tap selection.

**Schema** — both `accounts` and `categories` carry: `icon` (Lucide name), `emoji`, `image_url` (public URL in `account-category-images` storage bucket, 5 MB / image-only), `color` (hex/HSL — used for icon background and monogram fallback), `pinned`, `pin_order`. Display priority: `image_url > emoji > icon > monogram`.

**Sorting** (`src/lib/usageScoring.ts`): pinned items first (by `pin_order`), then recency-weighted usage from `transactions` (exp decay, 30-day half-life — same scoring family as §3.9), then name. Source uses `source_account_id + destination_account_id` counts; category uses `category_id`.

**Layout** (`ChipPicker.tsx`):
- Mobile (<md): single horizontal scroll row, ~8 chips visible, then "More …" opens a searchable popover (cmdk).
- Desktop (≥md): wrap; all visible.
- Selected = filled + ring; disabled (e.g. dest equal to source) = dim.

**Discovery**: each chip is wrapped in a Radix Tooltip. Hover (desktop) and 500 ms long-press (mobile) reveal the entity name even if the chip shows an icon only.

**Settings** (`/settings`): each account/category row has a Palette button opening `IconPicker` (Icon · Emoji · Image tabs + color swatch) and a Pin/Unpin toggle.

Out of scope: drag-to-reorder pinned items, server-side image resizing, applying chip pickers to recurring-rule editor or settings selects.

### 3.11 Suggestions on pending transactions

A pending row that arrives without a `category_id` (the phone's rule did not
set one) gets a proposal, never a value:

1. **History** — `suggestFromHistory` (`src/lib/pendingSuggest.ts`) matches
   the row's description, borrowed place name and raw notification text
   against the user's last 365 days of transactions, whole words only, and
   takes the category they used. No model, no tokens.
2. **AI** — rows history cannot place go, batched, to the connection bound to
   the `pending_enrich` action (`src/utils/pending.enrich.server.ts`), with
   the same context briefing the assistant gets. Returned category ids are
   validated against the user's categories before anything is stored.

Results land in `suggested_description`, `suggested_category_id`,
`suggested_tags`, `suggestion_source` (`history` | `ai`),
`suggestion_confidence` and `suggested_at`. `/pending` shows them as chips;
the user's tap (or "Apply suggestions") copies them into the draft. Nothing
writes `category_id` on its own.

Triggers, all best effort and all draining the whole backlog rather than one
row: the public POST (behind the response), `/pending` on mount, the
"Suggest" button (`force`, re-examines rows already looked at), saving an
enabled AI connection, binding `pending_enrich`, and a health probe that
finds a connection back online. A row nobody could place keeps
`suggested_at` NULL so the next trigger retries it.

Deferred: the feedback loop and gated auto-apply, see
`docs/pending-suggestions-feedback-loop.md`.

### 3.12 Transaction locations

Opt-in, `settings.capture_location`, **default false**. Five nullable columns on
both `transactions` and `pending_transactions`:

| Column | Type | Notes |
|---|---|---|
| `latitude`, `longitude` | `numeric(9,6)` | 6 dp ≈ 11 cm |
| `location_accuracy_m` | `numeric` | as reported by the device |
| `location_label` | `text` | required by the client before a save |
| `location_source` | `text` | `device` \| `manual` \| `search` |

Two constraints carry the invariants: `CHECK ((latitude IS NULL) = (longitude IS
NULL))` — a half-coordinate is always a bug — and a source allowlist. One partial
index, `(user_id, occurred_on DESC) WHERE latitude IS NOT NULL`, because the
recent-places picker reads only rows that have a point. `pending_transactions`
deliberately has none: that table is small and never queried by location.

**Capture is narrow on purpose.** `add.tsx` takes a reading only when the flag is
on, the transaction is new, and its date is today; any manual edit of the field
cancels it. Back-dated entries would otherwise record where the user is standing
now, which is worse than recording nothing.

**Labels have three sources.** Search and reverse lookup both go through
`geocode.functions.ts`, which is a *server* function wrapping Nominatim with
Photon as fallback — so the third party sees the server's IP, not the user's.
The third is `labelFromHistory()` in `api.public.pending-transactions.ts`: when a
device posts coordinates with no label, it scans the caller's last 200 located
transactions for one whose description matches and which is within
`matchRadiusM()` — the reported accuracy clamped to 150–500 m. Failing that it
falls back to `suggestPlaceFromProximity()`, which answers from the fix alone
when the evidence is neither thin nor divided: at least three visits on two or
more days, and one place holding 60 % of the traffic in radius. Terminals mostly
send "Kartenzahlung", so without that fallback the conjunctive path has nothing
to match and a familiar till stays nameless. Clustering is by the label the user
gave, never by coordinates — two shops in one station concourse are 20 m apart,
and merging them by distance answers confidently with the wrong one. It copies
**only the name**; coordinates stay as measured, and promoting the curated pin is
a separate tap in `/pending`.

**`suggested_location` is always one of the user's own pins**, copied
field-for-field from a stored row — never a centroid, which is a point nobody
chose and has no honest `location_source`. Proximity-only matches are capped at
0.85 confidence, below the 0.9 auto-apply gate in
`docs/pending-suggestions-feedback-loop.md`: being in the right place is enough
to offer a chip and never enough to write without a tap.

Two egress paths are **browser-side** and therefore expose the user's own IP:
Leaflet's tiles from `tile.openstreetmap.org`, and the `osmLink()` click-out.
Both are disclosed in `privacy.tsx` §6; `docsParity.test.ts` fails if a new host
appears in `src/` without being added there.

Locations are excluded from webhook payloads (`notifiers/types.ts`). They do
reach an AI provider in one case: `pending_enrich` sends `location_label`, plus
the **names** of up to 24 places the user has saved before with opaque
per-request refs (`p1`..) marking which are near each row — never a coordinate
and never a distance. The ordering carries "nearest first", so metres would buy
nothing and would be the only geographic quantity in the payload;
`renderPlaceTable`'s test asserts the block contains no coordinate, so re-adding
them fails the build.

The model is still never asked to *name* a place — it could only guess a label,
and a location without coordinates cannot be applied. It answers with a ref into
a table the server built and still holds, so the coordinates come from the
server. Refs are validated **per row**: a row with no fix is offered none and can
claim none. The model can only reorder a shortlist geometry already judged
plausible.

### 3.13 FinReader, and anything else posting from outside

FinReader is an Android app, **not in this repository**, distributed as a signed
APK from `apk.wi-wo.ch` behind Authentik. It reads bank notifications and POSTs
them to `/api/public/pending-transactions` with a user API token. Nothing about
the endpoint is FinReader-specific — it is the same contract any client gets.

Three properties carry the integration:

- **Idempotency on `(external_source, external_ref)`.** A repeat POST returns
  the existing row with `deduplicated: true` and **200** instead of 201, backed
  by a unique partial index. Android redelivers notifications and phones lose
  signal mid-request; without this the ledger would fill with duplicates.
  One thing a repeat POST *may* change: the location. A phone at a till often
  has no usable fix when the notification fires, so `refineLocation()` lets a
  meaningfully tighter reading replace the stored one and answers
  `location_updated: true`. Only while the row is `pending` — a confirmed row
  has already copied its location into a real transaction, and moving it would
  leave the two disagreeing — only when `isBetterFix()` is satisfied, so a
  redelivery whose fix merely jitters writes nothing, and never any other field:
  a second, worse parse of the same notification text must not rewrite what the
  user is about to review. It re-derives the borrowed label from the new point
  and clears `suggested_at`, which is what lets the new coordinates reach the
  place matcher at all.
- **`external_info` carries the raw notification text**, so a human reviewing
  the row sees what the bank actually said. It is also what `pending_enrich`
  forwards to an AI provider — the one AI call in the app the user does not
  trigger. That is why `privacy.tsx` §6a names it explicitly.
- **Nothing is booked.** Rows land as `pending` and only a confirmation in the
  UI creates a transaction. A confirmed row can no longer be deleted through
  the API (409): it has become the user's data, not the client's.

FinReader also reads `/api/public/recurring-proposals` to propose the amount and
date of an unposted occurrence — see §3.6.

## 4. SQL surface

| Object | Type | Purpose |
|---|---|---|
| `account_balances` | view | Per-account computed balance. |
| `category_month_spending(p_month DATE)` | function | Per-envelope row for the given month: `allocated`, `spent_or_received`, `variance`, plus group metadata (`group_id`, `group_name`, `kind`, `rolls_over`, sort orders). |
| `category_savings_balance(p_as_of DATE)` | function | Balance of every `rolls_over = true` envelope as of a date, with its provenance: `from_allocations`, `from_transactions`, `from_reallocations`, `from_sweeps`. |
| `ensure_month_budgets(p_month DATE)` | function | Idempotently copies the most recent prior budget into the given month for every active non-scope category. Called by the UI before reading month rows. |
| `envelope_reconciliation(p_as_of DATE)` | function | Every term of the balance-sheet identity (§3.3.1) plus `residual`, which must be 0.00. |
| `sync_transaction_tags()` | trigger function | Re-derives `transaction_tags` from the note on insert/update. |
| `update_updated_at_column()` | trigger function | Sets `updated_at = now()` on update; attached to all mutable tables. |
| `compute_due_date(p_month, p_rule, p_dom)` | function | Produces the un-adjusted scheduled date for a recurring rule in a given month. Clamps fixed day to month length. |
| `compute_effective_date(p_due, p_adjust)` | function | Applies the weekend adjustment (`before` / `after` / `none`). |
| `process_recurring_rules(p_today)` | function | Idempotent recurring-rule processor. Catches up missed occurrences, auto-posts where configured, and creates pending occurrences for manual rules within a 7-day lookahead. |
| `save_split_group(p_group_id, p_occurred_on, p_type, p_source_account_id, p_slices, p_location)` | function | Applies a whole edited split group in one transaction: updates the slices that keep their id, inserts new ones, deletes the ones the user removed. Returns the resulting ids in slice order. |
| `validate_transaction_split_group()` | trigger function | Deferred constraint trigger: at commit, every row of a `split_group_id` must share `user_id`, `source_account_id`, `occurred_on` and `type`, and none may be a transfer. |
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

Encryption at rest with a per-user key (device key + recovery code, pgcrypto blobs behind
same-name views) was analysed on 2026-09-12/13 and **postponed**. The full design record,
including the SQL/app inventory, performance estimate and phased plan, lives in
[`docs/encryption-at-rest.md`](./docs/encryption-at-rest.md).

## 7. Change log

> Entries below are **append-only history**: what was decided and why, as of
> that date. They are deliberately not updated when behaviour changes later —
> a change-log entry that describes today's code is no longer a record of
> anything. Sections 1–6 are the maintained description; if the two disagree,
> the sections above win. The same goes for the design records under `docs/`.

### 2026-09-22 — Places in pending suggestions

- **The place chip never rendered for a row that arrived with a fix.** The draft is
  seeded from the row's own coordinates, but the guard asked for `!d.location`, so the
  one case a place suggestion exists for could never show one. Unnoticed since the
  feature shipped because no production row has ever carried coordinates. Now three
  states: offer while the draft still holds the raw fix, stop once the user moves it
  or takes the suggestion.
- The four `suggests*` predicates moved to `lib/pendingSuggestView.ts`. Both `/pending`
  views held their own copies and the copies had drifted — one compared notes with
  `String.includes`, the other line by line, so the same row offered a remark in one
  view and not the other.
- `suggestPlaceFromProximity()` names a place from the fix alone: three visits on two
  or more days, one place holding 60 % of the traffic in radius. Clustered by the
  user's own label, not by coordinates. Answers with a stored pin copied
  field-for-field, capped at 0.85 confidence so it stays below the auto-apply gate.
  Runs before the model stage, so an unreachable endpoint cannot cost a place that
  geometry already found.
- **A later POST may refine the location**, and only the location, on a row that
  is still pending (`refineLocation()`). The dedup branch used to return the
  stored row without reading the payload, so a better fix arriving seconds after
  the notification was discarded. Gated on `isBetterFix()` so a redelivery whose
  reading jitters does not churn a label lookup and a suggestion pass.
- `pending_enrich` now offers the model a shortlist of the user's own places as opaque
  refs (`p1`..), validated **per row**. It is still never asked to name a place — it
  answers with a ref and the server supplies the coordinates. Names and dates cross the
  wire; no coordinate, no distance.
- **Rejected: tool calls to a nearby-POI service.** Nominatim reverse answers "what is
  at this point", not "what is near it"; only Overpass could, and querying it per
  notification would send precise coordinates to a new third party on the one AI path
  the user does not trigger — a timestamped movement trace. It also loses on merit: a
  POI the user has never visited has no honest `location_source` and cannot become a
  storable location. If POI lookup is ever wanted, its shape is a button in the place
  picker, where the tap is the consent.

### 2026-09-22 — Budgets as a grid

- `/envelopes?view=grid` renders envelopes × twelve months. It answers the two things
  the card view structurally cannot: what one envelope has done across a year, and
  setting several months at once. Toggle lives in the URL, like `transactions.tsx`;
  `AppShell wide` follows it; cards stay the default below `sm`.
- Migration `20260922140000_set_category_budgets_bulk.sql`. One transaction, one audit
  entry naming the span. Same guards as the single-cell RPC, all evaluated before any
  write. `amount: null` clears a cell rather than writing zero.
- **Seeding was capped at the current month** so twelve columns on screen cannot commit
  a year of budgets by accident. The grid's own reader (`fetchCategoryBudgetRange`)
  never seeds at all. A future month genuinely has no row until you say so, and so
  contributes nothing to a projected balance until decided.
- Migration `20260922160000_backfill_month_budgets.sql` then fixed the other half:
  seeding one month at a time left gaps whenever the app went unopened for a while,
  and a month with no row contributes no allocation and no sweep. `ensure_month_budgets`
  now backfills every gap up to the current month, each from its own nearest prior row.
  `category_month_spending` gained the same copy-forward fallback so the card view and
  the grid cannot disagree about a rowless month.
- Undecided cells render the value they *would* inherit, in italics. `resolveCells`
  mirrors `ensure_month_budgets`' copy-forward exactly, which is why the range reader
  fetches history rather than only the visible window — the nearest prior row is often
  older than the first column.
- Enter commits one month, ⌘/Ctrl+Enter carries the value to the right edge: the
  popover's two scopes, as the grid's two gestures.
- `effectiveKind` extracted to `budgetGrid.ts`; `computePlanTotals` now shares it
  rather than deriving the rule a second time.

### 2026-09-22 — Any month's budget is editable

- **The restriction was never a rule.** `settings.tsx` hard-coded `new Date()` as the budget write
  target and deleted every later row, so no other month was *addressable*. Nothing in the schema
  forbade it: `category_budgets`' only CHECK is day-of-month, RLS is ownership-only, there was no
  trigger and no server-side guard. `architecture.md` described the accident as design.
- Migration `20260922120000_set_category_budget.sql`: `set_category_budget(category_id, month,
  amount, scope)`, the single writer. `scope = 'month'` changes that month alone; `'forward'` also
  updates every later row and the `allocated_budget` template. Rejects scope envelopes and
  categories the caller does not own. Replaces three un-transacted client writes with one call.
- Editing a month that has fully elapsed writes an `audit_logs` entry via `log_audit_event`. Not a
  guard — a trace. Sweeps are computed at read time (§3.3.1), so the edit silently moves that
  month's sweep and every savings balance since.
- `/envelopes` gained the editing and Settings gained the month, so the two halves stopped living
  apart. `BudgetEditPopover` is shared by both; the scope choice is learned once.
- The envelopes page's month moved into the URL (`?month=YYYY-MM`), and the balances date now
  derives from it — past reads at the month's close, the current month reads today, a future month
  reads as a badged projection to its end. Previously `month` was component state and `asOf` a URL
  param, and stepping the month left the balances where they were.
- `BudgetBalanceCard` showed `categories.allocated_budget` while the current month's row could
  differ. Its totals moved to `computePlanTotals` in `budgetSummary.ts`, which takes that month's
  amounts, and the card now follows the selected month.

### 2026-09-22 — Scope remaining, and docs that match the code

- `add.tsx` impact preview: a scope's remaining budget is `allocated_budget + from_transactions`,
  not `+ cumulative_balance`. A scope is funded from its envelope for exactly what it spent when
  it closes, so its cumulative balance nets to ~0 and a fully-spent trip reported its budget as
  untouched — Greenfield 2026 read "600.00 of 600.00" having spent 502.90, now 97.10. Open
  scopes are unaffected, which is why this survived: the old formula was right for those.
- Help no longer promises a manual month-end sweep step; sweeping is computed at read time and
  there has never been anything to click. The reconcile entry describes the identity instead of
  the old, uninterpretable "drift".
- §3.3 rewritten: `rolls_over` decides the fate of the *remainder*, not whether an envelope is
  funded. New §3.3.1 records the balance-sheet identity, the income conduit, and why sweeps stay
  computed. §3.4 corrected — the old text described a savings balance built from allocations
  that rolling envelopes never received.

### 2026-09-22 — The identity closes: income variance sweeps too

- Migration `20260922000000_sweep_income_variance.sql`: the sweep in
  `category_savings_balance` no longer excludes income envelopes. `spent` is signed
  expense-minus-income, so an income envelope contributes `(-spent) - allocated`, i.e.
  received minus planned.
- A bonus or a short month previously reached no envelope at all. It was the last unexplained
  term in `envelope_reconciliation`, worth 371.92.
- **`residual` is now 0.00 at every date**, mid-month included: an income envelope holds
  `received - allocated` until the month ends and is then swept like any other, so it starts
  each month owing the plan and settles on payday. Verified daily across 2026-08-25, where
  `income_open` goes -7,144.47 -> -0.02 while `residual` never moves.
- `/envelopes` shows the terms that belong to no ordinary envelope (outstanding reimbursements,
  unallocated) with an explicit envelopes-against-accounts check, and income rows say how much
  is still to come.

### 2026-09-21 — Envelope opening balances

- Migration `20260921220000_envelope_opening_balances.sql`: `categories.opening_balance`,
  folded into `category_savings_balance.from_allocations`, and
  `envelope_reconciliation.unallocated` now carries whatever openings are *not* yet assigned.
- The accounts started with 62,712.31 that no envelope owned. Stored rather than derived: it is
  a statement about the past, not something recomputable from transactions. Rolling envelopes
  only — monthly envelopes reset, and scopes are funded from their envelope when they close.
- `unallocated` and the balance function use the same predicate, so what one adds the other
  drops: assigning an opening balance moves money between terms and leaves `residual` untouched.
  Residual falls from 63,084.23 to 371.92, which is now purely income variance over elapsed
  months.
- Settings shows the assignment running down (`assigned X of Y · unassigned Z`).

### 2026-09-21 — envelope_reconciliation: show the books balancing

- Migration `20260921200000_envelope_reconciliation.sql`: new
  `envelope_reconciliation(p_as_of)` returning every term of
  `accounts_total = rollover_total + expense_open + income_open +
  outstanding_reimbursements + unallocated + residual`, plus index
  `idx_tx_user_cat_date`. Replaces `reconciliation_summary`, whose `drift`
  compared accounts against envelopes that had never been allocated anything.
- Additive: no balance changes. `residual` is deliberately still large — it is
  exactly the unassigned account opening balances plus income variance over
  elapsed months, the two things opening balances and income sweeps will absorb.
- The open-month windows clip at `p_as_of` like `accounts_total` does; reading
  the whole calendar month made a mid-month reconciliation count spending that
  had not happened yet.

### 2026-09-21 — Rolling envelopes are allocated; one savings balance

- Migration `20260921160000_allocate_rollover_envelopes.sql`: `ensure_month_budgets` now skips
  only scopes, the `cleanup_budgets_on_savings_flip` trigger is gone, past months are backfilled
  idempotently from `allocated_budget`, and `category_savings_balance` gained `from_allocations`.
  Rolling envelopes had never received an allocation, so each one sat at minus its own spending
  (Lebensmittel −946.75 → +303.25). See §3.3, §3.4.
- Migration `20260921180000_one_savings_balance.sql`: the `category_savings_balance` **view** is
  dropped — it read allocations from `category_budgets`, which rolling envelopes never had, so
  its balance was structurally wrong — and `category_savings_balance_v2` takes the freed name.
  One balance, one source of truth. `DayRuleV2` / `WeekendAdjustV2` aliases removed too.

### 2026-09-21 — `is_savings` renamed to `rolls_over`

- Migration `20260921140000_rename_is_savings_to_rolls_over.sql`: `categories.is_savings` →
  `categories.rolls_over`, plus a verbatim recreation of the ten functions referencing it
  (plpgsql bodies are stored as text, so `RENAME COLUMN` does not rewrite them; views do follow
  automatically). `category_month_spending` exposes the column in its `RETURNS TABLE`, so it was
  dropped and recreated.
- The flag decided two things at once and named neither: whether an envelope's month-end
  remainder carries forward, and whether the month's cost is the allocation rather than the
  spend. Both follow from "does this roll over?". It also stops the name colliding with
  `category_groups.kind = 'savings'` (taxonomy) and `is_scope` (one-off events). See §3.3.
- Breaking change on `GET /api/public/categories`: the field is now `rolls_over`.
- Pure rename — `category_month_spending`, `category_savings_balance_v2`,
  `category_savings_balance`, `reconciliation_summary` and `category_savings_balance_series`
  return byte-identical output.

### 2026-09-21 — Reimbursements: link amounts, and writing off attributes money

- Migration `20260921100000_reimbursement_link_amount_guards.sql`: a reimbursement link may not
  exceed the settling transaction's amount, and links for one original may not total more than
  the original. Repairs the existing rows first, since the guard would otherwise reject the fix.
  Picking a link candidate used to record the *original's* remaining rather than what the refund
  actually paid, so a partial refund flipped the original to `settled` and the IOU vanished.
- Migration `20260921120000_reimbursable_written_off_status.sql`: new `written_off` status, and
  `recompute_reimbursable_status` no longer overrides an outcome the user chose by hand.
- `writeOffReimbursable` created an offsetting transaction on a real account, inflating the
  account total by the written-off amount and crediting the chosen envelope instead of charging
  it. It now creates no transaction: the original and the transactions that settled it are
  assigned to one envelope, so §3.7's reimbursement rule charges the true net. The same
  operation attributes an overpayment (lay out 201.20, get 202.00 back → the envelope is
  credited 0.80).
- "Mark as settled" is gone. Closing an IOU while the amount lands nowhere is the hole being
  fixed, so the only exits are repaying until fulfilled, or writing off.

### 2026-09-15 — Bill proposals on recurring occurrences

- Migration `20260915120000_recurring_occurrence_proposals.sql`: proposal columns on `recurring_occurrences` (see §3.6 "Bill proposals").
- Public API: `GET /api/public/recurring-rules` (for the phone's rule picker, with `accepts_proposals` and `next_pending_occurrence`) and `GET/POST/DELETE /api/public/recurring-proposals`.
- UI: upcoming card and post dialog show and pre-fill the proposal; posting stays manual.

### 2026-09-04 — Split groups: deferred validation, atomic group save

- The split-group invariant moved from a `BEFORE ROW` trigger to a `DEFERRABLE INITIALLY DEFERRED`
  constraint trigger. The old one compared the row being written against a sibling as it stood
  *before* the statement, so a slice-by-slice save could never move a split to another date or
  account — the first slice always disagreed with its untouched siblings.
- `save_split_group()` applies an edited group (updates + inserts + removals) in a single
  transaction; `/add` calls it instead of writing one row per request, so a group can no longer end
  up half-saved. The function re-checks the invariant with `SET CONSTRAINTS … IMMEDIATE` so a real
  violation is reported with its message instead of failing at commit.
- Group membership is checked per row: a slice id must be the caller's own and either already in the
  group or in no group at all.

### 2026-09-04 — Pending suggestions, honest AI plumbing
- History-then-AI category suggestions on `/pending` (§3.11); columns on
  `pending_transactions`, `pending_enrich` action, `docs/pending-suggestions-feedback-loop.md`.
- Every `resolveEndpoint` call site is now in `AI_ACTIONS` and bindable in
  Settings (`statement_classify` was not).
- `ai_audit_logs.kind` gains `statement_classify` and `pending_enrich`; the
  classifier no longer logs as `document_extract`.
- Privacy notice §6a and the help FAQ describe all AI features and the
  `ai_endpoints` table; the dead single-credential API (`ai_credentials`) is gone from the server code.

### 2026-04-30 — Observability: structured logging, audit trail, metrics

New §3.13 (below). Adds end-to-end observability so the app can be operated from a Coolify container with Promtail/Filebeat shipping logs to ELK/Loki and Prometheus scraping metrics.

- New table `public.audit_logs(id, occurred_at, user_id, action, table_name, row_id, diff, metadata)`. RLS allows `SELECT` for the owning user or admins; inserts only happen via `SECURITY DEFINER` triggers / RPCs (no client write policy).
- Generic trigger `public.audit_row_change()` attached to 13 mutating tables. For `INSERT` it stores the full row, for `UPDATE` a compact `{field: {old, new}}` diff (skipping `updated_at`), for `DELETE` the old row.
- RPC `public.log_audit_event(action, metadata)` for non-DB events. Wired into `AuthProvider` so login / logout / token refresh land in the same table.
- Retention: `public.prune_audit_logs(days int)` plus the public endpoint `/api/public/prune-audit` (Bearer-token protected). Default retention is configurable via the `AUDIT_RETENTION_DAYS` env var (default 365).
- Structured JSON logger at `src/lib/logger.ts`: dependency-free, emits one JSON line per event to stdout (info/debug) or stderr (warn/error). Fields: `ts, level, service, env, event, userId?, requestId?, durationMs?, status?, method?, path?, ip?, ua?, err?`. Designed for Promtail / Filebeat / Vector pickup from container stdout.
- Request middleware in `src/start.ts` wraps every server function and route handler. Generates a `requestId`, captures `durationMs`, `status`, best-effort `userId` (decoded from the Supabase access-token cookie), and increments Prometheus counters.
- Tiny in-process Prometheus registry at `src/lib/metrics.ts` (no deps, Worker-compatible). Pre-registered counters: `app_requests_total`, `app_request_errors_total`, `app_request_duration_ms_sum`, `app_audit_events_total`. Counters reset on Worker restart — Prometheus' `rate()` handles this.
- Endpoint `/api/public/metrics` exposes Prometheus text format. Protected by a `METRICS_TOKEN` env-var Bearer token (configured via Lovable Cloud secrets). Also exposes business gauges by reading aggregate counts (users, transactions, recent audit events).
- Public-facing API routes (`/api/public/{accounts,categories,transactions,attachments}`) replaced their ad-hoc `console.log` calls with the structured logger.
- Settings page got an **Audit log** card (`src/components/AuditLogCard.tsx`) — users see their own history; admins can filter by table/action across all users.

Operator integration:

```
# Prometheus scrape
- job_name: cash-flow
  metrics_path: /api/public/metrics
  authorization: { type: Bearer, credentials: <METRICS_TOKEN> }

# Nightly retention (Coolify scheduled task / cron)
curl -X POST -H "Authorization: Bearer $METRICS_TOKEN" \
     https://<host>/api/public/prune-audit
```

### 2026-04-29 — Insights area + envelope reallocations + tag fix

- New `/insights` route (`src/routes/insights.tsx`) tabbed into Overview / Trends / Breakdown / Projection (`src/components/insights/*`). Pure-frontend analytics layer backed by a new helper module `src/lib/insights.ts`; data fetched through the existing finance helpers, no new SQL surface.
- **Projection tab** now offers horizons *End of month*, *End of year*, *End of next year*, and *10 years*, with a confidence band rendered with theme-aware low-band colors (visible in both light and dark mode).
- **Recurring detector** card (`RecurringDetectorCard.tsx`) inspects historical transactions to suggest candidate recurring rules the user has not yet formalised.
- New table `public.category_reallocations(from_category_id, to_category_id, amount, occurred_on, note)` with a validation trigger (`validate_category_reallocation`) enforcing: amount > 0, both envelopes savings, both owned by the same user, not the same envelope. Implements moving cash between savings buckets without touching real accounts.
- `ReallocateDialog.tsx` exposes the action from the envelope detail; `category_savings_balance` factors reallocations in.
- New columns `categories.sweep_target_category_id` and `category_groups.sweep_target_category_id`, plus `settings.default_sweep_category_id`. These are the **(default) sweeping target**: leftover envelope balance at month end is conceptually swept to the configured target. Resolution order at the UI level: per-category target → per-group target → global default.
- `SavingsAndSweepsCard.tsx` surfaces sweep configuration and reallocation history on the dashboard.
- Recurring rules gained **descriptions with placeholders** for *manual-post* rules (see existing §3.6). New helper `apply_recurring_rule_backfill(rule_id, mode, today)` lets the user backfill historical occurrences either as posted transactions or as pending entries (variable-amount rules are coerced to pending — no amount known).
- Hashtag extraction trigger `sync_transaction_tags` rewritten with a `regexp_matches(... 'g')` loop so the **first character of a tag** is no longer dropped; existing rows backfilled.

### 2026-04-28 — Multi-currency, theme, format locale, role-based admin

- `accounts.currency_code` / `currency_symbol` per account; `account_balances` view rebuilt as `security_invoker` so per-user RLS still applies.
- `settings.net_worth_show_converted` toggles whether the dashboard sums all accounts at FX-converted value or shows a per-currency breakdown. Conversion utilities live in `src/lib/fx.ts`.
- `settings.theme` (`light | dark | system`) drives `src/lib/theme.tsx` provider; `settings.format_locale` decouples date/number rendering from the UI language (continues §3.6's locale story).
- `app_role` enum + `user_roles` table + `has_role(user_id, role)` `SECURITY DEFINER` helper. Roles live in a dedicated table to avoid privilege-escalation patterns; RLS on `audit_logs`, `auth_providers`, etc. consults `has_role(auth.uid(), 'admin')`.
- `category_month_spending` rewritten so the per-row **effective kind** is computed in SQL with `is_savings` taking precedence over `group.kind` (matches §3.3). UI no longer recomputes.
- Trigger `cleanup_budgets_on_savings_flip` removes monthly `category_budgets` rows when an envelope is flipped to `is_savings = true`.

### 2026-04-27 — Quarterly / yearly recurrences, attachments, split transactions

- `recurring_frequency` enum extended with `quarterly` and `yearly`. New `recurring_month_step(freq)` helper centralises the month delta; `process_recurring_rules` and `apply_recurring_rule_backfill` use it.
- `recurring_rules.is_variable_amount` + `estimated_amount`: amount-less rules generate **pending** occurrences only (auto-post forced off because there's no amount to post).
- `transactions.recurring_rule_id` back-link added so historical transactions can be traced to their rule.
- `transactions.split_group_id` groups multiple slices of one receipt; the Add screen exposes split entry, the Transactions list collapses splits visually.
- `transaction_attachments` table + Nextcloud OAuth integration (`nextcloud_connections`, `/api/nextcloud/callback`, `src/utils/nextcloud.*`) lets the user attach receipt files stored in their Nextcloud to a transaction.
- Renamed `payee` → `description` on both `transactions` and `recurring_rules` (the field was being used as a free-form description in practice).
- `account_balances` rebuilt to only count past/today transactions (future-dated transactions, e.g. scheduled posts, no longer inflate balances).

### 2026-04-26 — Storage hardening, account/category visuals

- `accounts` and `categories` gained `icon`, `emoji`, `image_url`, `color`, `pinned`, `pin_order` (see §3.10). Storage bucket `account-category-images` locked down: read for authenticated, write/update/delete restricted to row owner.

### 2026-04-24 — Auth, recurring rules, day heatmap, date format

- Lovable Cloud authentication enabled. Every existing data table flipped from `open_all` to per-user RLS (`user_id = auth.uid()`). `handle_new_user()` trigger seeds default `settings`, accounts, and categories on signup. `/login` route + `AuthPage.tsx` + `src/lib/auth.tsx` provider added.
- `auth_providers` table + admin-only RLS for configuring social providers from the in-app Settings page.
- `recurring_rules` + `recurring_occurrences` schema and dashboard surface (see existing §3.6 entry for the original 2026-04-24 milestone — this keeps the change-log entry accurate; nothing in §3.6 changed retroactively).
- New `settings.day_heatmap_threshold` and `settings.date_format` columns; `DayHeatmapCalendar.tsx` colors days hotter as the daily spend approaches the threshold.

## 8. Logging, auditing & metrics  *(also referenced as §3.13)*

Goal: when the app is self-hosted in Coolify, the operator must be able to (a) see what happened, (b) attribute actions to a specific user, and (c) feed external observability stacks (ELK, Loki/Grafana, Prometheus/Grafana, InfluxDB) without bespoke adapters.

### Layers

1. **Database audit trail (`public.audit_logs`)** — Postgres triggers capture every `INSERT/UPDATE/DELETE` on the 13 user-owned tables. Updates store a compact diff `{field: {old, new}}`; inserts/deletes store the full row. Auth events (login / logout / token refresh) are written via the `log_audit_event` RPC from `AuthProvider`. RLS: read your own rows or admin-read everything; clients cannot write directly.
2. **Structured JSON logger (`src/lib/logger.ts`)** — one JSON line per event to stdout/stderr. No dependencies, Worker-safe. Drop-in for Promtail / Filebeat / Vector running alongside the Coolify container.
3. **Request middleware (`src/start.ts`)** — wraps every server function and route handler. Generates a `requestId`, measures `durationMs`, captures `status`, decodes `userId` from the Supabase access-token cookie best-effort, and updates Prometheus counters.
4. **Prometheus metrics (`src/lib/metrics.ts` + `/api/public/metrics`)** — text exposition format, protected by a `METRICS_TOKEN` Bearer header. Counters reset on Worker restart by design.
5. **Retention (`public.prune_audit_logs` + `/api/public/prune-audit`)** — call nightly from a Coolify scheduled task; honours `AUDIT_RETENTION_DAYS` (default 365).

### JSON log shape

```json
{
  "ts": "2026-04-30T08:14:22.317Z",
  "level": "info",
  "service": "cash-flow",
  "env": "production",
  "event": "request",
  "method": "POST",
  "path": "/api/public/transactions",
  "status": 201,
  "durationMs": 42,
  "requestId": "9b3e4f1a2c0d",
  "userId": "8d…"
}
```

The logger always emits a single defensive `JSON.stringify`; it never throws and falls back to a minimal payload if serialization fails.

### Pre-registered counters

| Metric | Type | Description |
|---|---|---|
| `app_requests_total` | counter | Total HTTP requests handled |
| `app_request_errors_total` | counter | Requests resulting in 4xx / 5xx |
| `app_request_duration_ms_sum` | counter | Sum of request durations in ms (pair with `app_requests_total` for avg latency) |
| `app_audit_events_total` | counter | Audit events written |

Business gauges (current totals for users, transactions, recent audit events) are computed inside the metrics handler from aggregate queries.

### Operator integration

Operator-facing deployment topics — Prometheus scrape configuration, audit-log
retention scheduling, and container log shipping (Promtail / Filebeat / Vector
picking up stdout) — live in [`README.md`](./README.md#6-observability).

### Out of scope

- OpenTelemetry traces (only request-level `requestId` correlation today).
- Per-user rate limiting (could layer on top of `app_requests_total` with labels later).
- Histogram metrics for latency buckets (current sum/count gives mean; add `Histogram` to `metrics.ts` when needed).

## 9. Scheduled tasks (cron) for self-hosted deployments

Self-hosting deployment topics — running the migrator, building the app
container, wiring the `docker-compose.yml` stack against an existing Supabase
instance, and scheduling `process_recurring_rules_for_all_users` (Options A
/ B / C) plus audit-log pruning — live in
[`README.md`](./README.md#5-scheduled-tasks-cron).

The endpoint that the cron hits is `src/routes/api.public.process-recurring.ts`;
it calls the `SECURITY DEFINER` SQL function
`public.process_recurring_rules_for_all_users(p_today date)`, which runs the
same two-pass logic as the per-user `process_recurring_rules` (Pass 1: promote
auto-post pendings whose effective date arrived; Pass 2: extend the schedule
forward).

### Bugfix (2026-05-01) — promotion pass silently failing

The first cut of the promotion pass declared both loop targets as `RECORD` (`r RECORD; o RECORD;`) and then inside Pass 1 wrote `SELECT occ.id, occ.effective_on, r.* FROM ... JOIN recurring_rules r`. Postgres resolved the `r` in `r.*` to the **PL/pgSQL record variable** (still unassigned at that point in the function) instead of the SQL alias, raising `record "r" is not assigned yet` at runtime. The dashboard call site swallows the error (`processRecurringRules().catch(() => {})`), so pending occurrences kept showing up despite their rules being auto-post. Fix: alias the table as `rr` in Pass 1's SELECT (and rename the inner column alias to `occ_effective_on` for clarity). The same shape is used in `process_recurring_rules_for_all_users`.

### 2026-04-24 — Smart suggestions on Add
- New §3.9 documents a provider-based suggestion engine: `src/lib/suggestions/` with `historyProvider` (similar past transactions, scored) and `payeeProvider`. Top 5 ranked suggestions render as tappable chips above the form and prefill fields with sticky-typing + undo.
- Add screen also gained Quick-amount chips, Recent-tag chips, and Today/Yesterday/Last-weekend date shortcuts.
- Recent-transactions query on Add bumped from 50 → 200 rows for better scoring; no schema/SQL changes.
- New i18n keys: `add.suggestions`, `add.suggest.use_all`, `add.suggest.applied`, `add.suggest.undo`, `add.quick_amounts`, `add.recent_tags`, `add.date.{today,yesterday,last_weekend}` (DE + EN).

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