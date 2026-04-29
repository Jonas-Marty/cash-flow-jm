## Goal

Make the budget feature actionable in two places:

1. **In Settings (Envelopes card)** — show whether the plan is balanced
   (`income − expenses − savings = 0`) **while** allocations are being edited.
2. **In the monthly Overview (`/`) and `/envelopes`** — show an overall
   month verdict ("you'll stay within budget" / "projected overspend X")
   plus richer per-group totals (allocated, committed, projected, remaining).

Below I also list smaller useful additions and the model challenge you asked for.

---

## 1. Budget Balance Bar in Settings

Add a sticky `BudgetBalanceCard` at the top of the Envelopes section in
`src/routes/settings.tsx`. Pure client-side computation from
`categoriesQ.data` + `groupsQ.data` (no DB changes).

For each non-archived envelope, classify it the same way the RPC does:

- `is_savings === true` → savings
- else group kind (`income` / `expense`), defaulting to `expense` when
  ungrouped

Then compute:

```text
income       = Σ allocated of income envelopes
expenses     = Σ allocated of expense envelopes
savings      = Σ allocated of savings envelopes (manually-entered target,
                 not the running balance)
unallocated  = income − expenses − savings
```

Render:

```text
+-----------------------------------------------------+
| Monthly plan                                        |
| Income      CHF 6'000.00                            |
| Expenses  − CHF 4'200.00                            |
| Savings   − CHF 1'200.00                            |
| ----------------------------------                  |
| Unallocated  CHF   600.00   ✓ Balanced (>=0, <5%)   |
+-----------------------------------------------------+
| [stacked bar: expenses | savings | buffer]          |
+-----------------------------------------------------+
```

Status tones:
- `unallocated > 5% of income` → info "Buffer of X (Y% of income)"
- `unallocated ≈ 0` (|x| < 1) → success "Balanced"
- `unallocated < 0` → destructive "Over-allocated by X — reduce X or
  raise income"

Updates live as the user edits any allocation (re-runs on every
`categories` query refetch triggered by `updateCategoryBudget`). No
debounce needed — TanStack Query already invalidates on save (blur).

> Note on **savings allocations**: `is_savings` envelopes currently have
> their `allocated_budget` forced to 0 in the form. To make the balance
> meaningful we need a **monthly savings target** per envelope. We'll
> reuse the existing `allocated_budget` column for savings envelopes
> (drop the `disabled` on the input and stop overwriting to 0). Existing
> RPC ignores it for savings spending math, so this is a safe field
> reuse. Migration: none — only frontend stops zeroing it.

---

## 2. Month verdict header in `/` and `/envelopes`

Add a `MonthBudgetSummary` component shown above the envelope list. It
uses the same already-fetched data
(`fetchCategoryMonthRows`, `fetchPendingImpactsForMonth`).

Compute, across all non-savings rows:

```text
incomeAllocated   = Σ allocated  (income kind)
incomeReceived    = Σ spent_or_received (income kind)
incomePending     = Σ pendingDelta (income kind)
incomeProjected   = incomeReceived + incomePending

expenseAllocated  = Σ allocated  (expense kind)
expenseSpent      = Σ spent_or_received (expense kind)
expensePending    = Σ max(0, pendingDelta) (expense kind)
expenseProjected  = expenseSpent + expensePending

savingsTarget     = Σ allocated of savings rows  (new field, see §1)
savingsPosted     = Σ |spent_or_received| moved into savings this month
                   (derive from existing tx query already in /envelopes;
                   on /, fetch a small aggregate or skip the posted
                   number and only show target)

projectedNet      = incomeProjected − expenseProjected − savingsTarget
```

Render at top of the section:

```text
+-----------------------------------------------------------+
| April 2026 — projected balance: + CHF 320.00  ✓ on track  |
| Income     5'820 / 6'000  (180 expected)                  |
| Expenses   3'900 / 4'200  (300 pending)                   |
| Savings      900 / 1'200                                  |
| [horizontal bar showing projected vs allocated total]     |
+-----------------------------------------------------------+
```

States: `projectedNet ≥ 0` → success; `< 0 and > -5% of income` →
warning "tight"; `≤ -5%` → destructive "projected overspend".

---

## 3. Make per-group totals tell a story

Today the group header shows `actual / allocated` (small, muted). Replace
with a richer 3-number block that mirrors the per-row info:

```text
GROCERIES & HOUSEHOLD                       expense
spent 820 · pending 120 · of 1'000   →  60 left
[stacked bar]
```

Implementation: extend `GroupBlock` in `src/routes/index.tsx` and the
group card in `src/routes/envelopes.tsx`:

- Sum `allocated`, `spent_or_received`, `pendingDelta` across rows.
- Render the existing `StackedBudgetBar` at the group header level.
- Use the same overspend/projected logic as individual rows so
  the colour rules are consistent.

This makes the group header big and informative, fixing the "rather
small" observation.

---

## 4. Other useful additions (proposing for inclusion)

- **Carry-over hint**: in the Settings balance card, show the sum of
  current pending recurring rules per month so the user sees their
  "really committed" baseline vs the freely-allocated buffer.
- **Per-group plan check in Settings**: under each group in the
  envelopes editor, show `Σ allocated` so the user can see "Fixed
  costs: 2'400" without doing math.
- **Click-through**: clicking the Settings balance card jumps to the
  first over-allocated group; clicking the Overview verdict scrolls to
  the worst-projected envelope.
- Skipped: per-day burn-rate gauge — adds complexity without much
  decision value for a planning app.

---

## 5. Model challenge (you asked)

You're right that this nudges recurring rules from "fixed events" toward
"planned bucket spending." With these additions the model still works,
but two pressure points appear:

1. **Savings as allocation vs. as transaction**. We start treating a
   savings envelope's `allocated_budget` as a *target* to subtract from
   income. The actual savings tx (transfer to a savings account or
   savings envelope booking) is what really moves money. Risk: target
   and reality drift silently. Mitigation: the per-group "story" line
   already shows `target` vs `posted` so the gap is visible — no
   schema change needed, but we should label it clearly as
   "target / saved".

2. **Variable recurring rules now feed projections**. They already do
   via `pending_impact`, using `estimated_amount`. The new month
   verdict surfaces this prominently, which means a sloppy estimate
   visibly distorts the verdict. That's actually a feature (it forces
   the user to keep estimates honest) but worth a tiny UI cue:
   show "(based on estimate)" next to the pending number when any
   contributing rule is variable.

Where this **would** break the model: if you start using envelopes as
*real* containers (allocate 600, anything over goes red even when you
have cash). That requires per-envelope balance carry-over month to
month — out of scope here. The current month-by-month allocation model
still holds for the proposed additions.

---

## Files to touch

- `src/routes/settings.tsx` — add `BudgetBalanceCard`, allow editing
  allocation on `is_savings` envelopes (remove the `disabled` and the
  zero-coercion in `addCategory` / `toggleCategorySavings`), add
  per-group `Σ allocated`.
- `src/routes/index.tsx` — add `MonthBudgetSummary` above the envelopes
  section, beef up `GroupBlock` totals.
- `src/routes/envelopes.tsx` — same `MonthBudgetSummary` + richer group
  header.
- `src/i18n/index.tsx` — new strings: `settings.balance.*`,
  `dashboard.month_verdict.*`, group-total labels.

No database / RLS / RPC changes required.

---

## Acceptance

- Editing any allocation in Settings updates the balance card within
  one render; over-allocation shows destructive tone with the exact
  delta.
- Savings envelopes can have a non-zero monthly target.
- The Overview shows a single verdict line per month: projected net,
  tone, and one-sentence explanation.
- Each group card shows `spent · pending · of allocated → remaining`
  with a stacked bar, so "what's the state of housing this month?" is
  answerable without scanning every row.