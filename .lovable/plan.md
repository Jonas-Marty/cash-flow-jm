## Goal

Track foreign-currency cash spending during vacations without converting every transaction back to your main currency. Cash account balances stay in their native currency; net worth optionally shows them converted at a current FX rate.

## Concept

Introduce a per-account currency. Today, currency is a single global setting on `settings` (e.g. CHF) and every amount is implicitly that currency. We extend this so each account carries its own `currency_code` + `currency_symbol`, defaulting to the user's main currency. Transactions stay denominated in their **source account's** currency — no conversion stored on the transaction itself.

Use cases handled:

- **Card payment abroad** → card account stays in CHF; merchant amount you record is the CHF amount your bank charged. No change in behaviour.
- **Cash withdrawal abroad** → modeled as a **transfer** from your CHF card/bank account to a foreign-currency cash account. Because source and destination currencies differ, the transfer captures **two amounts**: amount leaving source (CHF) and amount arriving at destination (e.g. EUR).
- **Cash spend abroad** → normal expense from the EUR cash account, entered in EUR. Envelope budgets are in your main currency, so foreign-cash expenses are excluded from envelope spending (or optionally converted at a per-account "display rate" — see Open Questions).

Recurring rules are unchanged (you confirmed not needed).

## Data Model Changes

Migration adds:

1. `accounts.currency_code text not null default 'CHF'` and `accounts.currency_symbol text not null default 'CHF'`. Backfilled from each user's `settings` row.
2. `transactions.destination_amount numeric` — only set when `type = 'transfer'` AND source/destination currencies differ. Represents the amount credited to the destination account in its own currency. When null on a transfer, destination receives the same `amount` as source (current behaviour).
3. Validation trigger on `transactions`: `destination_amount` must be > 0 when set; must be null for non-transfers; must be null when source and destination share the same currency.

### Functions to update

- `account_balances` view + `account_balances_as_of(date)` RPC: when summing transfers crediting an account, use `coalesce(destination_amount, amount)` instead of `amount`.
- `category_month_spending` and the savings balance view are unaffected — they sum transactions that already use the source account's currency and savings categories are typically tied to main-currency accounts. We will document the constraint: an envelope (category) implicitly inherits the currency of the transactions posted to it. For vacation cash, attach those expenses to a dedicated "Travel cash" envelope so totals stay coherent.

## API & Types

- `Account` interface gains `currency_code` and `currency_symbol`.
- `transactionInputSchema` gains optional `destination_amount` (positive number, required when transfer crosses currencies). `normalizeTransactionInput` enforces the cross-currency rule.
- Public REST API (`/api/public/transactions`, `/api/public/accounts`) surfaces the new fields.

## UI Changes

**Settings → Accounts**: each account row gets a currency selector (default = user main currency). Disabled once the account has transactions, unless you confirm a destructive change (out of scope for this plan).

**Add / Edit transaction (`add.tsx`, `edit.$id.tsx`)**:

- The amount input shows the **source account's** currency symbol (already pulled per-account instead of the global one).
- For transfers, when source and destination currencies differ, a second amount field appears labelled "Amount received (EUR)" with its own currency symbol. Required to submit.
- Quick-amount chips and validation continue to operate on the source amount.

**Lists (`transactions.tsx`, `index.tsx` recent, `DayPreview`)**: each transaction is rendered with the symbol of its source account, not the global setting. Daily/transfer totals group per currency (e.g. "−CHF 120 · −EUR 40") rather than summing across currencies.

**Envelopes (`envelopes.tsx`, dashboard envelopes)**: continue to display in main currency. Foreign-currency expenses linked to an envelope are shown with their native symbol in the transaction list under the envelope, but the totals/variance bars only count main-currency amounts. A subtle hint ("+ EUR 40 in foreign currency") is appended when applicable.

**Net worth (`index.tsx`)**:

- Default: a "Total in CHF" line plus per-currency sub-totals ("EUR 85 · USD 0"). No FX call; clear and deterministic.
- Optional toggle in Settings → "Convert foreign balances to main currency" — when on, fetches rates from a free public endpoint (e.g. `https://api.frankfurter.app/latest?from=EUR&to=CHF`) once per session, caches in React Query for 12 h, and shows a single combined net worth with a small "(approx., FX as of …)" caption. If the fetch fails, fall back to the per-currency view.

## Technical Details

- Migration order: add columns with defaults → backfill `accounts` from `settings.currency_*` → add validation trigger → update views/RPCs.
- Trigger uses `EXISTS` lookups on `accounts` to compare currencies; marked `STABLE` and runs on `BEFORE INSERT OR UPDATE`.
- FX fetch lives in a small helper `src/lib/fx.ts` using `fetch`. No API key, no secret needed (Frankfurter is free, ECB-backed). Wired through TanStack Query with `staleTime: 12h`.
- Backwards compatibility: existing transactions have `destination_amount = null`, so balances are unchanged for same-currency setups.

## Out of Scope (call out explicitly)

- Per-transaction FX rate history / P&L on FX gains.
- Multi-currency recurring rules.
- Multi-currency envelopes / budgets in non-main currency.
- Editing an account's currency after it has transactions.

## Open Questions

- For envelopes, do you want foreign-cash expenses **excluded** from variance (cleanest, recommended) or **converted at a fixed per-account display rate** you set manually (e.g. "1 EUR = 0.95 CHF")? Go with reccomended
- For net worth, default to **per-currency breakdown** or **auto-convert via Frankfurter API**? Can we have both? Foreign currency collapsed by default to save space. 
- Should the cash withdrawal flow get a dedicated shortcut on the Add screen ("Withdraw cash abroad") that pre-fills a transfer with two amount fields, or is the generic transfer with the second amount field enough? Generic transfer enough. Force the user to only fill second field when source an target account differ. Also only show in that case 