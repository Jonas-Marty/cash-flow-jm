## Goal

Add rich data visualization and insights without cluttering the existing Dashboard or Transactions pages. Help you answer:

- *Where does my money go?* (breakdowns by category / tag / account)
- *How is my wealth trending and where will it be in 6–24 months?* (projection)
- *What recurring-ish spend isn't yet a rule that I could cut?* (subscription detector)
- *Just fun-to-look-at* charts you can pivot.

## Navigation: separate menu item

Add a new top-level route `**/insights**` with menu entry "Insights" (icon: `LineChart`).

Reasons not to merge into Transactions:

- Transactions is already heavy (filters, list, edit). Adding charts mixes "browse rows" with "explore aggregates".
- Insights benefits from its own URL state (period, grouping, chart type).
- A separate route lets us deep-link, e.g. `/insights?view=breakdown&group=tag&period=ytd`.

We will, however, also add **two small chart widgets to existing pages** as entry points:

- Dashboard: a compact "Spending vs income" sparkline (last 6 months) → links to Insights.
- Transactions: when filters are active, a "📊 View as chart" button → opens Insights pre-filtered.

## The Insights page — 4 tabs

```text
┌─ Insights ────────────────────────────────────────────────┐
│ [ Period: This month ▾ ]  [ Currency: CHF (converted) ▾ ] │
├───────────────────────────────────────────────────────────┤
│ Tabs: Overview | Breakdown | Trends | Projection          │
└───────────────────────────────────────────────────────────┘
```

### 1. Overview

- KPI strip: Income, Expenses, Net, Savings rate (for the period).
- Stacked bar: monthly income vs expense, last 12 months.
- Top 5 categories + Top 5 tags + Top 5 merchants (descriptions) for the period.

### 2. Breakdown (the pie/bar tab)

- **Group by** chips: `Category` | `Group` | `Tag` | `Account` | `Type` (income/expense/transfer).
- **Filter by** type chips: `Expenses` (default) | `Income` | `Both`.
- **Chart type** toggle: `Pie` | `Bar (horizontal)` | `Treemap`.
- Click a slice → drill into "transactions in this group" (a slide-over showing the underlying rows, with link to Transactions pre-filtered).
- "Other" bucket for the long tail (configurable threshold).

### 3. Trends (line/area)

- **X axis**: time (Day / Week / Month based on period).
- **Series**: pick what to plot — `Net worth`, `Cash assets`, `Liabilities`, `Income`, `Expenses`, `Net`, `Savings`, or any specific Category/Tag/Account.
- **Chart type**: `Line` (multi-series) | `Stacked area` | `Cumulative line`.
- Compare-to-previous-period overlay (toggle).

### 4. Projection — "Projected wealth"

- Line chart of net worth: solid line for actuals, dashed for projection.
- **Baseline window** selector: `Last 6 mo` / `12 mo` / `24 mo` (default 12).
- **Project forward**: `3 mo` / `6 mo` / `12 mo` / `24 mo`.
- Three lines:
  - **Trend** — linear regression on monthly net-worth points.
  - **Avg savings rate** — current net worth + (avg monthly net × months ahead).
  - **Recurring-only** — current net worth + sum of scheduled recurring rules in the window (lower bound).
- Confidence band (±1 std dev of monthly net) around the trend line.
- Plain-language summary: *"At your current pace, you'll reach ~CHF 84,200 by Apr 2027 (±5,800)."*

## Insight extras (the "get the most out of the data" bits)

These render as small cards under each tab, generated client-side from existing data:

1. **Recurring spend detector** (Overview tab)
  - Group expenses by `description` normalized (lowercase, strip numbers/dates).
  - Flag groups with ≥3 occurrences over ≥3 distinct months and stable amount (CV < 30%) that are **not** linked to a `recurring_rules` row.
  - Show: name, monthly average, last seen, "Create rule" button.
  - Helps you find sneaky subscriptions (Netflix-tier stuff) you forgot.
2. **Month-over-month movers** (Breakdown tab)
  - Categories/tags whose spend changed most vs your 3-month average.
  - "🔺 Groceries +42% vs your average" / "🔻 Dining −18%".
3. **Day-of-week / day-of-month heatmap** (Trends tab)
  - When do you spend? Useful for "weekend creep" awareness.
4. **Savings-rate gauge** (Projection tab)
  - Current month savings rate vs YTD vs last year.
5. **"What if" slider** (Projection tab)
  - Slider: "If I cut expenses by X%, projection becomes…"
  - Recomputes the projection in real time.

## URL state (deep-linkable)

`validateSearch` on `/insights`:

- `tab`: overview | breakdown | trends | projection
- `period`: this_month | last_month | ytd | last_12mo | last_24mo | all | custom (+ from/to)
- `group`: category | group | tag | account | type
- `chart`: pie | bar | treemap | line | area
- `txType`: expense | income | both
- `currency`: main | per

## Technical notes

- **Charts**: use `recharts` (already pulled in via `src/components/ui/chart.tsx`). No new deps.
- **Data fetching**: extend `src/lib/finance.ts` with:
  - `fetchTransactionsRange(fromISO, toISO)` — bulk fetch with tags joined.
  - `fetchMonthlyNetWorthSeries(months)` — re-uses `fetchAccountBalancesAsOf` per month-end.
  - `fetchTagAggregations(fromISO, toISO)` — sum amount grouped by tag.
- **Aggregation**: do grouping/projection in the browser from a single transactions payload per period. For long ranges (24 mo) cap at e.g. 5000 rows and warn if hit.
- **FX**: respect `settings.net_worth_show_converted`; reuse `useFxRates` + `convert`.
- **Recurring detector**: pure client-side over fetched transactions + `recurring_rules`. No new tables.
- **Files**:
  - `src/routes/insights.tsx` (route + tab shell, URL state)
  - `src/components/insights/OverviewTab.tsx`
  - `src/components/insights/BreakdownTab.tsx`
  - `src/components/insights/TrendsTab.tsx`
  - `src/components/insights/ProjectionTab.tsx`
  - `src/components/insights/RecurringDetectorCard.tsx`
  - `src/lib/insights.ts` (aggregation + projection math: linear regression, CV, MoM diffs)
  - Edit `src/components/AppShell.tsx` (add Insights tab — bottom nav becomes 6 cells; "Add" stays primary in middle).
  - Edit `src/i18n/index.tsx` (DE + EN strings).
  - Optional: small "View as chart" button on `src/routes/transactions.tsx`.

## Open questions before I build

1. **Bottom nav**: it currently has 5 slots. Add Insights makes 6 — OK to widen, or should I move Settings into a "More" menu on mobile? --> widen, add transaction should still be featured prominent
2. **Net-worth history**: should projection use **end-of-month snapshots** computed from transactions (accurate but slower, 12+ queries) or just project forward from the **current balance + avg monthly net** (fast, less precise)? I lean toward snapshots cached per session. --> snapshots cached per session, be sure to invalidate affected snapshots when adding/editng/deleteing transaction in the past
3. **Recurring detector sensitivity**: default thresholds (≥3 occurrences, ≥3 months, CV<30%) — fine, or want a tuning UI? --> add input fields on page (default to your proposition)

If you have no preference, my defaults: widen bottom nav to 6 (Settings stays), use snapshot-based net-worth history with React Query caching, ship the detector with fixed defaults plus a "show all candidates" toggle.