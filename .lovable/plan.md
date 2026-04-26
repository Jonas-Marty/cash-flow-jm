## Problem

The dashboard's net worth, assets, and liabilities currently include **future-dated transactions**. The `account_balances` view sums every transaction regardless of `occurred_on`, so a transaction dated next week already shifts today's balance.

We want:
1. **Current** balances → only transactions with `occurred_on <= today`.
2. **Projected** balances → at two horizons: **end of current month** and **end of current year**, including all known future transactions (manual + already-generated recurring occurrences) up to that horizon.

## Approach

### 1. Database — new view + RPC (migration)

- **Replace `account_balances`** so it only counts transactions with `occurred_on <= CURRENT_DATE`. This makes today's dashboard "current" by default, and also fixes the same bug everywhere else the view is used.
- **Add an RPC `account_balances_as_of(p_date date)`** returning the same shape as `account_balances` but counting transactions with `occurred_on <= p_date`. We'll call it twice from the client (end of month, end of year).
  - For the projection to also include scheduled-but-not-yet-posted recurring occurrences, the RPC will additionally fold in `recurring_occurrences` rows where `status = 'pending'` and `effective_on <= p_date` (using the linked rule's amount/type/source/destination).
  - Returns: `id, name, type, archived, opening_balance, balance`.

### 2. Client — `src/lib/finance.ts`

- Add `fetchAccountBalancesAsOf(date: string): Promise<AccountBalance[]>` that calls the new RPC.
- Helpers `endOfMonthISO()` and `endOfYearISO()`.

### 3. Dashboard — `src/routes/index.tsx`

- Keep the existing **Net worth / Assets / Liabilities** card showing **today's** values (now correctly excluding future dates thanks to the view fix).
- Add a new **"Projected" card** below it (or beside it on `md:`) with two tabs / two columns:
  - **End of {month name}** (e.g. "End of April")
  - **End of {year}** (e.g. "End of 2026")
  - Each shows: projected Net worth (large), and small Assets / Liabilities sub-tiles, in the same visual style as the current card.
  - A small caption: "Includes scheduled recurring transactions and future-dated entries up to {date}."
- Use two new `useQuery` calls keyed by the horizon date.

### 4. i18n

Add keys to `src/i18n/index.tsx` (en + de):
- `dashboard.networth_current` ("Current net worth" / "Aktuelles Vermögen")
- `dashboard.projected` ("Projected" / "Prognose")
- `dashboard.projected_eom` ("End of month" / "Monatsende")
- `dashboard.projected_eoy` ("End of year" / "Jahresende")
- `dashboard.projected_caption` ("Includes future-dated and scheduled transactions through {date}." / German equivalent)

### Out of scope (for now)

- Envelopes / category month rows already filter by month range, so they aren't affected.
- The "Recent transactions" list keeps showing all transactions (including future) — separate concern; can be revisited later if needed.
- No changes to how transactions are entered.

## Files touched

- New migration: update `account_balances` view + add `account_balances_as_of` RPC.
- `src/lib/finance.ts` — new fetcher + date helpers.
- `src/routes/index.tsx` — new Projected card, two queries.
- `src/i18n/index.tsx` — new keys (en + de).
