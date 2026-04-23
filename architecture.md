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

## 4. SQL surface

| Object | Type | Purpose |
|---|---|---|
| `account_balances` | view | Per-account computed balance. |
| `category_month_spending(p_month DATE)` | function | Per-envelope row for the given month: `allocated`, `spent_or_received`, `variance`, plus group metadata (`group_id`, `group_name`, `kind`, `is_savings`, sort orders). |
| `category_savings_balance` | view | All-time `allocated_total`, `spent_total`, `balance` for every `is_savings = true` category. |
| `ensure_month_budgets(p_month DATE)` | function | Idempotently copies the most recent prior budget into the given month for every active category. Called by the UI before reading month rows. |
| `sync_transaction_tags()` | trigger function | Re-derives `transaction_tags` from the note on insert/update. |
| `update_updated_at_column()` | trigger function | Sets `updated_at = now()` on update; attached to all mutable tables. |

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