## Goal

Make it easy to see how much money sits in each savings envelope **right now**, at **any chosen date**, and **over time**.

The database already computes cumulative envelope balances for an arbitrary date (`category_savings_balance_v2(p_as_of)`, returning cumulative balance plus the split into transactions / reallocations / sweeps). Everything below builds on that — no change to how envelopes work.

## 1. As-of date switch on the Envelopes page

- Next to the existing month navigation, add a small "Balances as of" control: a date picker defaulting to today, with quick shortcuts (Today, End of selected month, End of last month).
- Every savings envelope row gains a prominent **balance as of that date** figure, next to the existing monthly activity numbers.
- A header line shows the **total across all envelopes** as of that date.
- Changing the month keeps the as-of date independent, so "March view, balance today" is possible; a shortcut sets it to that month's end in one click.
- Amounts respect the existing privacy blur.

## 2. Envelope detail sheet with history

- Clicking an envelope opens a side sheet with:
  - Current balance (as of the chosen date) and the breakdown: from transactions, from reallocations, from sweeps.
  - A **balance-over-time chart**: end-of-month points, range selectable (12 / 24 months / all).
  - A **running ledger** below the chart: transactions, reallocations and sweeps in date order, each with the running balance after it, so any jump in the chart can be traced to its cause.
  - A date picker to jump the chart marker/ledger to any exact day.

## 3. Total-savings history card

- A card on the Envelopes page: month-by-month total of all envelopes, stacked per envelope (top envelopes named, rest grouped as "Other"), with a tooltip listing each envelope's balance at that month-end.
- Toggle between stacked area and total line.

## History granularity

End-of-month series for charts, plus a free date picker for exact any-day balances (both served by the same as-of query).

## Technical notes

- New SQL function `category_savings_balance_series(p_from date, p_to date)` returning `(category_id, as_of, cumulative_balance)` for each month-end in the range — one query instead of N round-trips. Security definer, scoped to `auth.uid()`, granted to `authenticated`, matching the existing v2 function's shape.
- New fetchers in `src/lib/finance.ts`: `fetchSavingsBalanceSeries(from, to)`; reuse `fetchSavingsBalancesV2(asOf)` for the as-of switch (it already accepts a date).
- Envelopes page: as-of date held in URL search params so a view can be reloaded/shared; queries keyed on it.
- New components: `EnvelopeDetailSheet.tsx`, `SavingsHistoryCard.tsx`; charts via the recharts setup already used in Insights.
- Ledger rows come from existing data (transactions of the category, `category_reallocations` both directions, sweeps), merged and sorted client-side.
- New i18n keys in EN and DE.
