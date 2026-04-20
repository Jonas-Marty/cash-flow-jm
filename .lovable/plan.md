
# Personal Finance — Cash Flow & Envelope Budgeting (Milestone 1)

A mobile-first web app to track liquid cash, envelope budgets, and credit-card liabilities. Single-user, no auth yet (DB modeled so Keycloak/OIDC can drop in later). Single configurable currency. Empty by default, managed from Settings. Envelopes reset monthly with no rollover.

## Data Model (Lovable Cloud / Postgres)

- **accounts** — `id, name, type ('asset'|'liability'), opening_balance, archived, created_at`
- **categories** — `id, name, allocated_budget (monthly), archived, sort_order, created_at`
- **transactions** — `id, occurred_on (date), amount (positive decimal), payee, note, type ('expense'|'income'|'transfer'), source_account_id, destination_account_id (nullable), category_id (nullable), created_at`
- **transaction_tags** — `transaction_id, tag` (extracted from `#hashtags` in note for fast filtering)
- **settings** — `id, currency_code, currency_symbol`

Balances are computed via SQL views (account opening balance ± transaction sums). Category "spent this month" is computed from transactions in the current calendar month: expenses subtract, category-assigned income (reimbursement) adds back. Global Income metrics exclude reimbursements (income with a `category_id`).

Schema includes a nullable `user_id` column on every table for future Keycloak integration without a migration.

## Pages & Routes

- `/` **Dashboard**
  - Net worth tile (Assets − Liabilities) with red/green delta
  - Two columns: **Assets** and **Liabilities** with current balances
  - **Envelopes** list: each shows allocated vs. spent, progress bar (green → amber → red as it fills, red when over budget), remaining amount
  - Recent transactions strip
  - Floating "+" button → Add Transaction

- `/add` **Add Transaction (mobile-first)**
  - Big numpad-style amount input at the top
  - Type segmented control: **Expense / Income / Transfer**
  - Account dropdown (defaults to most-used) — for Transfer, shows Source + Destination
  - Category dropdown (hidden for Transfer; optional for Income → reimbursement)
  - Payee field with autocomplete from history
  - Note field with `#tag` chip extraction preview
  - Date (defaults today)
  - Save & New / Save buttons

- `/transactions` **Transactions**
  - List grouped by date, color-coded amounts (red expense, green income, neutral transfer)
  - Filters: account, category, type, tag (from `#hashtags`), date range, free-text payee
  - Tap row → edit/delete

- `/envelopes` **Envelopes detail**
  - Per-category view with month selector, allocated vs. spent, list of transactions in that envelope, reimbursement entries highlighted

- `/accounts` **Accounts detail**
  - Per-account view with running balance ledger

- `/settings` **Settings**
  - Currency picker (CHF/EUR/USD/GBP/…) with symbol
  - Manage Accounts (create/edit/archive, set type and opening balance)
  - Manage Categories (create/edit/archive, set monthly allocated budget, reorder)

## Key Business Rules

- **Expense**: source_account balance −amount; category spent +amount
- **Income (no category)**: source_account balance +amount; counts in global Income
- **Income (with category)** → Reimbursement: source_account +amount; category spent −amount; **excluded** from global Income totals
- **Transfer**: source −amount, destination +amount; never touches categories. Paying off a credit card = transfer from Asset → Liability account (liability balance moves toward 0).
- **Tags**: `#word` tokens parsed from the note on save → stored in `transaction_tags` for indexed filtering
- **Monthly reset, no rollover**: each calendar month, envelope "spent" recomputes from that month's transactions only; unspent budget from prior months is discarded

## UX & Design

- Tailwind v4 with the existing design tokens; mobile-first layout, bottom tab bar on small screens (Dashboard / Add / Transactions / Settings), top nav on desktop
- Numeric keypad input on `/add` (`inputMode="decimal"`) with large tap targets
- Consistent color semantics: green inflow, red outflow, slate transfer, amber warnings, red over-budget
- Empty states with one-tap CTAs that link to Settings to create the first account/category
- Skeleton loaders for lists; toast feedback on save/delete

## Out of Scope (Milestone 1)

Investments tracking (logged as plain expenses against an "Investments" envelope you create), recurring transactions, multi-currency conversion, attachments, real auth (DB ready for it).
