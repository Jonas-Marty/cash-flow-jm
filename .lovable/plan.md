## Goal

Make the Dashboard envelope blocks and the Envelopes page reflect not only **committed** transactions for the current month, but also **pending recurring occurrences** (auto-post or manual) whose `effective_on` falls inside the same month. Visualize the pending portion as a second segment of a stacked progress bar (orange/warning tone) on top of the existing committed bar.

## Concept

For every category in the current month we will compute three numbers:

- `committed` — what the database function `category_month_spending` returns today (real transactions).
- `pending` — sum of pending `recurring_occurrences` for that category whose `effective_on` is in the current month, signed the same way (expense ⇒ +spent, income ⇒ +received, income on expense category ⇒ -spent).
- `projected = committed + pending` — what the month will look like once everything posts.

The progress bar becomes two stacked segments:

```text
|■■■■ committed (green/warning/red) ■■■■|■ pending (orange) ■|             |
0 ────────────── allocated ──────────────────────────────► 100%
```

- Committed segment keeps current tone logic (success → warning at ≥80% projected → destructive when projected over allocated).
- Pending segment is always `bg-warning` (orange) and sits immediately after the committed segment.
- If `projected > allocated`, the over-portion is rendered as `bg-destructive` so the user immediately sees a future overspend.
- The numeric label next to each row shows `committed / allocated`, with a small subline like `+ pending  →  projected` when `pending > 0`.
- For income groups, a similar approach: committed received vs. allocated, with a pending indicator showing what is still expected.
- For savings categories, show pending allocation/spend impact below the balance (no bar — savings already use balance display).

## Where this is computed

Done client-side. On both `/` and `/envelopes` we already fetch:
- `category_month_spending(p_month)` (committed numbers).
- We will additionally fetch **pending** recurring occurrences for the visible month and join them to categories.

Add a small helper in `src/lib/finance.ts`:

```ts
export interface PendingCategoryImpact {
  category_id: string;
  type: "expense" | "income";
  amount: number;       // signed by rule type, like committed
  count: number;
}
export async function fetchPendingImpactsForMonth(month: string): Promise<PendingCategoryImpact[]>
```

Implementation: `select` from `recurring_occurrences` joined with `recurring_rules`, filtered by `status = 'pending'`, `effective_on` in `[monthStart, monthEnd]`, `category_id is not null`, and `type in ('expense','income')` (transfers ignored — they don't affect envelopes). Use `is_variable_amount ? estimated_amount : amount` for the value, just like `account_balances_as_of` already does. Group/sum in JS by `category_id`.

Tie the query into React Query keys per month: `["pending_impact_month", monthKey]`. Invalidated whenever rules/occurrences change (existing `qc.invalidateQueries()` in `UpcomingCard` already covers this).

## Stacked progress bar component

Extract a small inline component (no new file needed, keep it next to `GroupBlock`) that takes:

```ts
{ allocated: number; committed: number; pending: number }
```

Renders three flex segments:
- committed (tone depending on `projected/allocated`)
- pending (warning/orange)
- over-projected (destructive) — only if `projected > allocated`, replacing the tail

Caps at 100% width; if `projected > allocated`, scale segments proportionally to `projected`.

## UI changes

### `src/routes/index.tsx` — `GroupBlock` (expense + income rows)
- Fetch pending impacts once at the Dashboard level: `useQuery(["pending_impact_month", m], () => fetchPendingImpactsForMonth(m))`.
- Pass map down to `GroupBlock`.
- Expense row: replace the single-segment bar with the stacked one. Update label:
  - main: `committed / allocated`
  - sub (only if pending > 0): `+ <pending> pending → <projected> projected`
  - remaining/over text uses **projected**, with a clarifying suffix like `(incl. pending)` when pending > 0.
- Income row: append a small `+ <pending> expected` chip when pending > 0; recompute variance with projected for the colored hint.
- Savings row: add a sub-line `+ <pending allocation> · -<pending spend> upcoming` when applicable.

### `src/routes/envelopes.tsx`
- Same query (same query key — shared cache).
- Same stacked bar, same label changes for expense/income/savings.

### `UpcomingCard`
No changes — it already lists the source items. (Could add a soft visual link later, out of scope.)

## i18n strings (EN + DE)

Add to `src/i18n/index.tsx`:

- `env.pending_suffix`: "+ {x} pending" / "+ {x} ausstehend"
- `env.projected_suffix`: "→ {x} projected" / "→ {x} prognostiziert"
- `env.remaining_with_pending`: "{x} remaining (incl. pending)" / "{x} verbleibend (inkl. ausstehend)"
- `env.over_with_pending`: "Over by {x} (incl. pending)" / "Überzogen um {x} (inkl. ausstehend)"
- `env.income_expected`: "+ {x} expected" / "+ {x} erwartet"
- `env.savings_pending`: "Upcoming: +{a} alloc · -{b} spend" / "Ausstehend: +{a} zugeteilt · -{b} ausgaben"

## Out of scope

- Changing the SQL `category_month_spending` function — pending is purely a UI overlay so it stays clearly separable from real data.
- Showing pending in `/transactions` (already visible via Upcoming card).
- Per-day heatmap inclusion of pending — separate request if wanted later.

## Files to edit

- `src/lib/finance.ts` — add `fetchPendingImpactsForMonth` + types.
- `src/routes/index.tsx` — fetch pending, stacked bar, updated labels.
- `src/routes/envelopes.tsx` — fetch pending, stacked bar, updated labels.
- `src/i18n/index.tsx` — new strings.