# Reconcile `category_groups.kind` ↔ `categories.is_savings`

## The problem today

Two overlapping mechanisms classify an envelope's behaviour:

1. `category_groups.kind` ∈ {`income`, `expense`, `savings`} — original design.
2. `categories.is_savings` (boolean) — added later when standalone savings envelopes
  without a parent group were needed.

They are inconsistently coupled:

- **SQL truth** (`category_month_spending`): math is driven **only** by `g.kind`.
Income groups receive; expense/savings groups use the expense formula. The
`is_savings` column is returned but **not used** to switch formulas.
- **UI truth** (`envelopes.tsx`): grouping is driven by an *effective kind*
= `is_savings || group.kind==='savings' ? 'savings' : group.kind`. A row with
`is_savings=true` inside an expense group is rendered under a synthetic
"Savings" header → inconsistent with what the RPC actually computed.
- **Settings**: adding a category to a savings-kind group force-sets
`is_savings=true`; clearing the group keeps `is_savings=true`. So the two
fields drift apart on purpose.
- **Allocated budget**: savings envelopes use `category_savings_balance`
(all-time view, keyed on `is_savings=true`), while monthly budget rows are
suppressed for them. So `is_savings` *is* a real switch — just not for the
monthly RPC.

Net: a category can be (group=expense, is_savings=true) and the dashboard,
envelopes screen, and savings totals all disagree about what it is.

## Decision: keep both, but with crisp, documented roles

Rather than collapsing one into the other, formalise this:

- `**categories.is_savings` becomes the single source of truth for *behaviour***
(does this envelope accumulate across months, or reset monthly?).
- `**category_groups.kind` becomes purely a *taxonomy / default* concern**
(where new envelopes land, what header they render under, what the "add
envelope" form pre-selects). It is **not** used to drive math anymore.

Why not drop `kind` entirely?

- Users want a header taxonomy ("Income", "Fixed costs", "Variable", "Savings
pots") that survives even when a single category is reclassified.
- Standalone (no-group) envelopes still need *some* bucket on screen — the
synthetic income/expense/savings buckets we already render.
- A group with `kind=income` is a useful default: any envelope created inside
it should default to "income behaviour" (and any transaction logged against
it defaults to income type in the Add form).

Why not drop `is_savings`?

- Standalone savings envelopes (no group) must exist.
- Users sometimes want a *single* savings pot inside an otherwise expense
group ("Misc → Holiday fund"). Forcing them to create a sibling savings group
for one envelope is friction.

## Concrete changes

### 1. SQL — make `is_savings` the behaviour switch

Update `category_month_spending(p_month)` so the income/expense/savings branch
is selected per row by:

```
effective_kind =
  CASE
    WHEN c.is_savings THEN 'savings'
    WHEN g.kind = 'income' THEN 'income'
    ELSE 'expense'
  END
```

Returned `kind` column = `effective_kind` (so the UI no longer needs to
recompute). A savings row returns `allocated=0`, `spent_or_received=0`,
`variance=0` from this RPC — its real numbers come from
`category_savings_balance` as today.

Migration also: when a savings envelope's `is_savings` flips on, delete its
`category_budgets` rows (already done in UI; enforce via trigger so it can't
drift).

### 2. Settings UX — clarify the contract

- **Group form**: keep the kind selector, relabel to "Default behaviour for
new envelopes" with helper text:
*"New envelopes added to this group will default to this behaviour. You can
override per-envelope."*
- **Envelope form / row**: the "Savings envelope" toggle stays. When you add
an envelope to a group, the toggle **pre-selects** to match `group.kind`
(`income`-kind groups → toggle is replaced by an "Income envelope" indicator
derived from group kind; `savings`-kind → toggle on; `expense`-kind →
toggle off). The user can flip it.
- **Visual cue**: in the envelope list, show a small badge when a category's
effective behaviour differs from its group's kind ("Savings in Expense
group"), so the divergence is intentional and visible.
- **Income envelopes**: today there is no per-category "is_income" flag. We
keep that derived from the group: an envelope in an income-kind group is
treated as income. Standalone (no group) envelopes default to expense unless
`is_savings=true`. This is the only remaining case where `kind` drives
math — documented as such.

### 3. Envelopes screen — single computation path

Remove the client-side `effectiveKind` logic. Trust the RPC's returned `kind`.
Group rows by:

- If the row has a `group_id`, render under that group header (with the group's
display name). The header subtitle shows the group's *default* kind.
- If no `group_id`, fall back to a synthetic header named after the row's
effective kind.

Mixed-behaviour groups (e.g. an expense group containing one savings envelope)
render under the group header; each row's body uses the per-row effective
kind for its formula. This is consistent with the SQL.

### 4. Architecture doc

Rewrite §3.3 to explain the new model explicitly:

- Two coordinated fields, two clear jobs:
  - `category_groups.kind` = **taxonomy + default for new envelopes**.
  - `categories.is_savings` = **per-envelope behaviour switch (savings vs not)**.
  - Income behaviour stays group-derived (no `is_income` per category) because
  we have no use case for "one income envelope inside an expense group".
- A truth table showing what (`group.kind`, `is_savings`) combinations mean
and which formula applies.
- A "why not collapse them" subsection capturing the design rationale above
so a future contributor doesn't try to merge them again.

## Files to change

**SQL migration**

- New migration: rewrite `category_month_spending` to use `effective_kind`;
optional trigger to clear `category_budgets` when `is_savings` flips on.

**Edited**

- `src/routes/envelopes.tsx` — drop client-side `effectiveKind` logic, trust
RPC `kind`, render mixed groups correctly.
- `src/routes/settings.tsx` — relabel group-kind selector, smarter
`is_savings` defaulting on add, divergence badge in the list.
- `src/routes/add.tsx` / `edit.$id.tsx` — derive default tx type from the
selected category's effective kind (using group + is_savings).
- `src/lib/finance.ts` — small helper `effectiveKind(category, group)` for
client use where the RPC isn't involved.
- `architecture.md` — rewrite §3.3, add the truth table and rationale.

**Not changed**

- `category_savings_balance` view (already keyed on `is_savings`).
- Existing data: no row migration needed; the new RPC formula yields the
same numbers for all current rows because today every `is_savings=true`
row already lives in a savings-kind group (the UI enforces it).

## Open question for you

Before I implement, please confirm one preference:

**Should the group `kind` selector stay visible in the Settings UI, or
should it be hidden and inferred from "what's the most common behaviour
of envelopes in this group"?** My recommendation is to keep it visible
(option A above) because it's a useful default and a clear taxonomy
header — but if you'd rather have one less concept on screen, I can hide
it and infer.