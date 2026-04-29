## Goal

Slim down the Dashboard to focus on the four questions you actually ask it:
1. What's my net worth?
2. Is anything pending my approval?
3. Where am I heading this month?
4. Where am I heading this year?

Remove the heavy envelope drilldown and surface the most useful "what cost me a lot" snapshot.

---

## New dashboard order (top → bottom)

1. **Net Worth** card — unchanged
2. **Projected** (EoM + EoY tiles) — unchanged
3. **Assets / Liabilities** two-up — unchanged
4. **Upcoming & due** — limited to current month, max 5 visible (keep "Show more" / "Show all (N)")
5. **This month — budget verdict** — only the `MonthBudgetSummary` block (the single accumulator card at the top of envelopes). Drop all `GroupBlock` / category rows. Keep the "View all" link to `/envelopes`.
6. **Recent transactions** — capped at 5 (was 8). Keep "View all".
7. **NEW: Top transactions this month** — two side-by-side mini-lists: Top expenses and Top income, current month only, non-recurring (`recurring_rule_id IS NULL`), max 5 each, sorted by amount desc. Each row: description, date, amount. Empty state when none.
8. **NEW: Trend strip** (the "directions" answer) — small card with two compact rows:
   - **This month**: net income − expenses so far, vs. same point last month (Δ% and arrow)
   - **Year to date**: net YTD vs. same period last year (Δ% and arrow)
   Pure numbers + arrow + tone color, no chart. Cheap to compute from `transactions`.

---

## Detailed changes

### `src/routes/index.tsx`
- Remove the `GroupBlock` rendering loop and the `groupRows` / `GroupBlock` helpers (still used? check; if only used here, delete them).
- Keep `MonthBudgetSummary` rendered standalone inside the section, not inside the envelopes loop.
- Change `fetchTransactions(8)` → `fetchTransactions(5)`.
- Add new query for "this month transactions" (one fetch, filtered client-side or via `.gte('occurred_on', monthStart).lt(..., nextMonth)`). Reuse for both Top X and Trend.
- Add new query for "last year same-window transactions" used by Trend (small range, only sums needed).
- New components below.

### `src/components/UpcomingCard.tsx`
- Filter `occs` to entries whose `effective_on` falls in the current calendar month (keep overdue from earlier months too — they're "needs approval now"; treat overdue as visible regardless of month).
- Cap initial `visibleCount` to 5 (was 10). Keep "Show more (+5)" and "Show all".

### NEW `src/components/TopMonthTransactionsCard.tsx`
- Props: `{ transactions: Transaction[], symbol, accountById, monthStart }`.
- Filters: `occurred_on` in current month, `type === "expense" | "income"`, `recurring_rule_id == null`.
- Renders two columns (stack on mobile): Top 5 expenses (desc by amount) and Top 5 income (desc by amount). Same row style as recent list.

### NEW `src/components/TrendStripCard.tsx`
- Props: monthly + YTD aggregates already computed in route.
- Two rows, each: label · current value · arrow + Δ% vs. comparison period.
- Comparison: month → same day-of-month last month (e.g. day 15 → Apr 1–15 vs Mar 1–15). YTD → Jan 1 to today vs. Jan 1 to today last year.
- Excludes transfers; includes recurring (you want the real picture).

### i18n (`src/i18n/index.tsx`)
Add (DE + EN):
- `dashboard.top_month.title`, `dashboard.top_month.expenses`, `dashboard.top_month.income`, `dashboard.top_month.empty`
- `dashboard.trend.title`, `dashboard.trend.this_month`, `dashboard.trend.ytd`, `dashboard.trend.vs_last_month`, `dashboard.trend.vs_last_year`, `dashboard.trend.no_baseline`

---

## Layout sketch

```text
┌──────────── Net Worth ────────────┐
├──────────── Projected (EoM | EoY) ┤
├── Assets ──────┬── Liabilities ───┤
├──────────── Upcoming (≤5) ────────┤
├──── This month verdict (summary) ─┤   ← single accumulator only
├──────────── Recent (≤5) ──────────┤
├── Top exp (≤5) ┬── Top inc (≤5) ──┤   ← non-recurring, this month
├──────────── Trend (mo + YTD) ─────┤
└───────────────────────────────────┘
```

---

## Open questions

None blocking — I'll proceed with the trend comparisons as described (month-to-date vs same window last month; YTD vs same window last year, transfers excluded). If you prefer different comparisons (e.g. full previous month vs. month-to-date, or a 7-day moving trend), say so before I start.
