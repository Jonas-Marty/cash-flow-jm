# Continue Multi-Currency: UI + Net Worth + Envelopes + Public APIs

Pick up where the foundation (DB schema, FX lib, Settings UI) left off.

## 1. Add / Edit transaction form (`src/routes/add.tsx`)

- Read the selected source/destination accounts and pull their `currency_symbol` from the cached accounts list.
- Replace the static currency symbol next to the amount input with the **source account's symbol** (or destination's symbol for income).
- For `transfer` type: when source and destination have **different `currency_code`**, render a second amount input labelled "Amount received" with the destination account's currency symbol.
  - Auto-suggest the destination amount using the live FX rate from `src/lib/fx.ts` (rounded to 2 decimals), but let the user overwrite it (they should enter the actual amount their cash machine dispensed).
  - Pre-fill on currency change; do not overwrite if user already edited.
- When currencies match, keep `destination_amount = null` (the trigger enforces this anyway).
- Wire `destination_amount` into the insert/update payload through the existing `transactionInputSchema`.

## 2. Transaction lists & detail rows

Files: `src/components/TransactionList.tsx` (or wherever rows render — find via `rg`), `src/routes/transactions.tsx`, `src/routes/index.tsx` recent-transactions card, account detail screen.

- Render each row's amount with the **source account's `currency_symbol`** (for transfers, also show `→ <destSymbol> <destination_amount>` when present).
- Group totals at the top of the transactions page **per currency** instead of summing across currencies. Format: `-CHF 120.00 · -EUR 40.00`.
- Account detail balance header: use the account's own currency symbol (already available from `account_balances_as_of`).

## 3. Net Worth display (`src/components/AccountBalances.tsx` or net-worth widget)

- Group accounts by `currency_code`.
- **Main currency** (from `settings.currency_code`) is always shown as a top-line total.
- **Foreign currencies**: only render the section if the user actually has at least one account with a non-main currency. Render it **collapsed by default** with a chevron toggle showing per-currency subtotals.
- Add a Settings toggle `net_worth_show_converted` (boolean, default false). When on:
  - Use `src/lib/fx.ts` to convert each foreign-currency subtotal into main currency and show a single "Net worth (converted)" line under the breakdown with caption "approx, FX as of <date>".
  - On FX failure, silently fall back to per-currency breakdown.
- Toggle lives in Settings → "Display" section.

## 4. Envelopes / category variance (live FX)

- The `category_month_spending` RPC sums `t.amount` directly, currency-blind. We need to convert foreign-currency expenses to main currency before they enter variance.
- Approach: keep the SQL RPC as-is (returns raw native sums per category), and do the conversion **client-side** in the envelopes screen:
  - Fetch transactions for the month (already fetched in many places) joined with their account's currency.
  - For each transaction whose account currency ≠ main currency, convert via `src/lib/fx.ts` (live rate, cached 12h via React Query).
  - Recompute `spent_or_received` and `variance` per category using converted values.
  - Show a small "≈" indicator on category rows that contain converted foreign-currency expenses, with tooltip "Includes foreign-currency expenses converted at live FX rate".
- Wrap in a hook `useCategoryMonthSpendingConverted(month)` that wraps the existing query and applies the conversion.

## 5. Settings additions

- Add toggle: **"Convert net worth to main currency"** (writes `settings.net_worth_show_converted`).
- Migration: `ALTER TABLE settings ADD COLUMN net_worth_show_converted boolean NOT NULL DEFAULT false;`

## 6. Public API endpoints

Files: `src/routes/api/public/accounts.ts`, `src/routes/api/public/transactions.ts` (find with `rg`).

- **Accounts response**: include `currency_code`, `currency_symbol`.
- **Transactions response**: include `destination_amount` (nullable). Update OpenAPI/JSON shape comment if any.
- **Transactions POST/PATCH**: accept optional `destination_amount`; pass through to insert/update. Validation trigger handles correctness — return 400 with the trigger's error message on failure.

## 7. Transaction edit flow

If there's a separate edit route/sheet (`src/routes/transactions.$id.tsx` or similar), apply the same dynamic symbol + second amount field as the Add form. Find with `rg "destination_account_id" src/routes`.

## Technical details

- FX hook (already built): `useFxRate(from, to)` from `src/lib/fx.ts`, returns `{ rate, asOf, isLoading }`.
- Currency formatting helper: add `formatMoney(amount, symbol)` to `src/lib/finance.ts` if not present, used everywhere instead of hard-coding the global symbol.
- Per-currency grouping helper: `groupByCurrency<T>(items, getAmount, getCurrency)` → `Map<currencyCode, total>`.
- All conversion is **display-only**; persisted amounts always stay in the account's native currency.

## Files

**New**
- `src/hooks/useCategoryMonthSpendingConverted.ts`
- `src/lib/money.ts` (formatting + grouping helpers, or extend `finance.ts`)

**Edited**
- `src/routes/add.tsx` — dynamic symbol, conditional second amount field
- `src/routes/transactions.tsx` — per-currency totals, per-row symbols
- `src/routes/index.tsx` — recent transactions row symbols
- `src/components/AccountBalances.tsx` (or equivalent) — grouped net worth + collapsible foreign section + optional conversion
- `src/routes/settings.tsx` — net-worth conversion toggle
- `src/routes/envelopes.tsx` (or equivalent) — converted variance + indicator
- `src/routes/api/public/accounts.ts` — expose currency fields
- `src/routes/api/public/transactions.ts` — expose + accept `destination_amount`
- Any transaction edit screen found via `rg`

**Migration**
- Add `net_worth_show_converted boolean` to `settings`.
