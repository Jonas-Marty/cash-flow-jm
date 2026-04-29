# Envelope Reallocations & Savings Reconciliation

Move toward a true (partial-coverage) envelope model: savings envelopes hold cumulative balances, leftovers from expense envelopes flow into them, and you can shuffle money between savings envelopes without touching real bank accounts.

## Mental model (what we agree on)

- **Partial coverage.** Savings envelopes (Taxes, Vacation, GA, General Savings…) reserve specific amounts. Non-savings envelopes (Rent, Groceries, Clothes…) just track monthly spending vs allocation. There is no "Unassigned bucket" requirement.
- **Funding.** Each month, every non-savings envelope's `(allocated − spent)` is treated as **leftover**. Leftover (positive or negative) belongs to a designated **sink savings envelope**. There's a global default sink (e.g. "General Savings") and any envelope can override it.
- **No "close month".** Sweeps are computed continuously from existing data, so editing an old transaction simply recalculates everything. Nothing is ever "locked".
- **Savings envelope balance = cumulative.** All credits (sweeps + explicit savings transactions + reallocations in) − all debits (savings spending + reallocations out), across all time. We also surface monthly activity.
- **Reallocations** are pure bookkeeping moves between two savings envelopes. No real-money transaction is created.
- **Reconciliation invariant.** Across all time:
  `Σ savings envelope balances == Σ account balances − Σ (allocated − spent for non-savings envelopes that haven't been swept yet)`
  In practice with continuous sweeps: **Σ savings balances == Σ account balances**. We surface any drift as a diagnostic ("Unreconciled: X CHF"), never block the user.

## What we'll build

### 1. Data model (new migration)

- New table `category_reallocations`:
  - `id`, `user_id`, `from_category_id`, `to_category_id`, `amount` (>0), `occurred_on`, `note`, timestamps.
  - RLS: `user_id = auth.uid()`. Trigger validates both categories belong to user and both are savings envelopes (`is_savings = true`).
- New column `categories.sweep_target_category_id` (uuid, nullable). Per-envelope override for where leftovers go.
- New column `settings.default_sweep_category_id` (uuid, nullable). The global default sink.
- New column `category_groups.sweep_target_category_id` (uuid, nullable) — group-level override (optional, used when no per-category override).

Resolution order for an expense envelope's sweep target: category override → group override → settings default.

### 2. Computation layer (new SQL function)

`category_savings_balance(p_as_of date)` returns per-savings-envelope:
- `cumulative_balance` — running balance up to `p_as_of`.
- `month_activity` — net change during the current month.
- `from_sweeps`, `from_transactions`, `from_reallocations` — breakdown so the UI can explain the number.

Cumulative balance formula for a savings envelope `S`:
```
  + Σ transactions where category = S and type = income (credit to savings)
  − Σ transactions where category = S and type = expense (spent against savings)
  + Σ reallocations.to = S
  − Σ reallocations.from = S
  + Σ leftovers swept to S, where leftover for envelope E in month M =
       (allocated_E,M − net_spent_E,M),
       and S is E's resolved sweep target,
       summed across all months ≤ p_as_of where E is non-savings.
```

A second function `reconciliation_summary(p_as_of)` returns:
- `accounts_total` (sum of all account balances at date)
- `savings_total` (sum of savings envelope cumulative balances)
- `unswept_current_month` (this month's not-yet-final variance — informational)
- `drift` = accounts_total − savings_total − unswept_current_month

### 3. UI

**Envelopes page (`src/routes/envelopes.tsx`)**
- Each savings envelope shows: big **cumulative balance**, plus small "this month: +X / −Y".
- Row actions: **"Reallocate…"** (opens dialog), **"Edit sweep target"** (only on non-savings rows).
- Archiving a savings envelope with a non-zero balance opens a required dialog: "Move remaining 1,240 CHF to →" (savings envelope picker, defaults to default sink). Archive proceeds only after the reallocation is recorded.

**New "Reallocate" dialog** (`src/components/ReallocateDialog.tsx`)
- Fields: From envelope, To envelope, Amount, Date (defaults today), Note.
- Both pickers filtered to savings envelopes.
- Esc to close (matches your keyboard preference).

**Dashboard (`src/routes/index.tsx`)**
- Add a small "Reserved (savings)" totals strip alongside existing budget summary: total cumulative reserved + reconciliation diagnostic if drift ≠ 0.
- For non-savings envelopes, append a tiny "→ sweeps to {target name}" hint under the row when a non-default override is set.

**Settings (`src/routes/settings.tsx`)**
- New section "Savings & sweeps":
  - Pick **default sweep target** (savings envelope).
  - List of envelopes/groups with non-default sweep targets, with quick edit.
  - Reconciliation card: accounts total vs savings total, with drill-down link.

**New page `src/routes/reallocations.tsx`** (linked from envelopes & settings)
- History list of reallocations (date, from → to, amount, note), with edit/delete.

### 4. Server functions

In `src/server/envelopes.functions.ts` (new):
- `createReallocation`, `updateReallocation`, `deleteReallocation`.
- `setSweepTarget({ scope: "category"|"group"|"default", id?, target_id })`.
- `archiveSavingsEnvelope({ id, move_remaining_to })` — wraps reallocation + archive in one call.
- `getSavingsBalances(asOfDate)` and `getReconciliation(asOfDate)` calling the new SQL functions.

### 5. i18n

Add keys under `envelopes.reallocate.*`, `envelopes.sweep.*`, `settings.savings.*`, `dashboard.reserved.*` (DE + EN).

## Edge cases handled

- **Editing old transactions** recomputes leftovers automatically — no "close month" needed.
- **Overspend** in a non-savings envelope produces a negative sweep, debiting the sink (matches your Excel behavior).
- **No sweep target configured** → leftovers are simply not swept; reconciliation drift surfaces this so you notice and pick one.
- **Deleting a savings envelope used as sweep target** → blocked with a message, must reassign first.
- **Reallocation between non-savings envelopes** → blocked at trigger level.

## Out of scope (can be follow-ups)

- Auto-budgeting suggestions ("you have 500 free, allocate?").
- Multi-currency reallocations.
- Goal targets per savings envelope (e.g. "reach 6000 by Dec").
