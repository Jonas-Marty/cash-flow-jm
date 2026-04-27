## Goal

Support a "running-balance pot" envelope (e.g. **IT-Support**) that:
- accepts both income and expense bookings against itself,
- shows a cumulative balance like a savings envelope,
- does **not** appear in the regular monthly expense budget with a forced 0 budget.

## Why the current model can't do it cleanly

The data model already has the right primitive: `categories.is_savings` is its own boolean, independent of group kind. A savings envelope shows a running balance and is excluded from the "remaining budget" expense framing.

However, the UI currently couples `is_savings` to the **group's** `kind`:
- Adding/changing a category's group sets `is_savings = (group.kind === 'savings')`.
- A category with no group falls into the synthetic "Uncategorized" expense bucket and demands a monthly budget.

So today the only way to get savings-style behavior is to put the category into a savings-kind group — but the user wants it standalone, no group, no monthly budget.

## Solution

Decouple `is_savings` from the group, and make the dashboard/envelopes treat any `is_savings` category as a savings-style row regardless of whether it has a group or which kind that group is.

### 1. Settings UI — make "Savings envelope" a per-category toggle

In `src/routes/settings.tsx`:
- Add a **"Savings envelope"** switch in the category create form and as a column on each category row.
- Stop overwriting `is_savings` in `updateCategoryGroup`: keep whatever the user chose. Only auto-set `is_savings = true` when the group is a savings-kind group; never auto-clear it when the group changes.
- When "Savings envelope" is on, hide / disable the **Monthly budget** input and store `allocated_budget = 0` (also skip the per-month entry in `category_budgets` for that category — see step 3).
- The user can now create "IT-Support" with: no group, savings = on, no budget.

### 2. Envelopes & dashboard — render savings rows separately even without a group

In `src/routes/envelopes.tsx` and `src/routes/index.tsx` (the `groupRows` logic):
- When grouping rows, branch on `is_savings` first: any `is_savings` category goes into a synthetic **"Savings"** bucket (or its real savings group if it has one), shown with the running-balance header that already exists for savings.
- Only non-savings categories without a group fall into the "Uncategorized" expense bucket. So a standalone savings envelope no longer pollutes the budget section.

### 3. Stop generating monthly budgets for savings envelopes

In the `ensure_month_budgets` SQL function (migration):
- Add `AND c.is_savings = false` to the inserted set, so savings envelopes never get rows in `category_budgets`.
- Existing zero-amount rows for the new IT-Support category can be left in place (harmless) or cleaned up with a one-off delete.

`category_month_spending` already returns `is_savings`, and the dashboard already uses the savings code path when it's true, so no further backend change is needed for the monthly view.

### 4. Add transaction flow

`src/routes/add.tsx` already treats `c.is_savings || kind === "savings"` as savings. Both income and expense bookings against the IT-Support envelope will flow through and be reflected in the running balance via the existing `category_savings_balance` view.

## Result for the user's scenario

- Create category **IT-Support**, no group, toggle **Savings envelope = on**. Budget field is hidden.
- Book income (Twint/cash receipts) against it as `income` → balance grows.
- Book expenses (treats you buy yourself) against it as `expense` → balance shrinks.
- It appears in the **Savings** section of the dashboard and Envelopes page with a running balance, never in the monthly expense budget.

## Technical summary

- Migration: alter `public.ensure_month_budgets` to skip `is_savings` categories.
- `src/routes/settings.tsx`: add `is_savings` toggle in create form + per-row; stop overwriting `is_savings` from group kind on update (only set true when group is savings-kind); hide budget input when savings.
- `src/routes/envelopes.tsx` and `src/routes/index.tsx`: in `groupRows`, route any `is_savings` row into a "Savings" bucket regardless of group, keep the existing savings header rendering.
- No schema change required (the `is_savings` column already exists).
