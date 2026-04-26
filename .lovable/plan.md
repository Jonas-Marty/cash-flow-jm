## Goal

Allow recurring rules where the **schedule is fixed but the amount is not known in advance** (e.g. foreign-currency subscriptions, usage-based bills like Backblaze). The tool reminds you when it's due, you fill in the actual amount before posting.

## Behavior

- A rule can be marked **"Variable amount"**. When set:
  - The amount field becomes optional (estimate only, used for projections).
  - `auto_post` is forced to `false` and disabled — variable rules can never auto-post.
  - Pending occurrences appear in the **Upcoming** card with an "Enter amount" input instead of a fixed value.
  - Posting requires entering an amount (>0); the entered amount is what gets stored on the transaction.
- An optional **estimated_amount** field is used for forecasting (End of month / End of year projections) so net worth still reflects the upcoming charge approximately. If left empty, projections treat the rule as 0 until posted.
- For **fixed-amount rules**, behavior is unchanged.

## Database migration

1. **`recurring_rules`**:
   - Add `is_variable_amount boolean NOT NULL DEFAULT false`.
   - Add `estimated_amount numeric NULL` (used only when `is_variable_amount = true`).
   - Make `amount` nullable (was `NOT NULL`). For variable rules, `amount` will be null; for fixed rules it stays required at the application level.
   - Add a CHECK-style validation **trigger** (per project rules — no time-based CHECK constraints, but this one is value-based so a CHECK is fine; still, use a trigger to stay consistent): if `is_variable_amount = false` then `amount IS NOT NULL`; if `is_variable_amount = true` then `auto_post = false`.

2. **`process_recurring_rules`**: skip auto-post path entirely when `r.is_variable_amount = true` (always insert as `pending`). Schedule generation is unchanged.

3. **`account_balances_as_of`**: when summing pending occurrences, use `COALESCE(r.estimated_amount, 0)` for variable rules instead of `r.amount`. Fixed rules continue to use `r.amount`.

4. **`apply_recurring_rule_backfill`**: for variable rules, the `'post'` mode is meaningless (no amount). Force `'none'` (mark past as skipped) when `is_variable_amount = true`.

## Frontend changes

### `src/lib/finance.ts`
- Extend `RecurringRule` type: `is_variable_amount: boolean`, `estimated_amount: number | null`, and change `amount: number` → `amount: number | null`.
- Update `postOccurrence` signature: `overrides.amount` is **required** when the rule is variable. Throw a clear error if missing.
- Update `describeSchedule` to optionally append "variable amount" badge text.

### `src/components/RecurringRulesCard.tsx` (rule dialog)
- Add a **"Variable amount"** switch.
- When ON:
  - Replace the "Amount" input label with "Estimated amount (optional, for projections)".
  - Hide / disable the "Auto-post" switch (force off, with helper text "Variable rules can't auto-post").
  - In the past-start backfill choice, hide the "Post past transactions" option.
- Save logic: pass `is_variable_amount`, `estimated_amount` (parsed or null), and `amount` (null when variable).
- Show a small "Variable" badge on the rule list row.

### `src/components/UpcomingCard.tsx`
- For occurrences whose rule is variable:
  - Show an inline numeric input (instead of the fixed amount label) with placeholder = estimated amount (or empty).
  - **Post** button is disabled until a positive amount is entered.
  - Pass the entered amount as override to `postOccurrence`.
- Fixed rules: unchanged.

### i18n (`src/i18n/index.tsx`)
- `recurring.variable_amount` ("Variable amount")
- `recurring.variable_amount.help` ("Amount changes each time. You'll be asked to enter the actual value when posting.")
- `recurring.estimated_amount` ("Estimated amount (for projections)")
- `recurring.variable_no_autopost` ("Variable rules can't auto-post.")
- `recurring.variable_badge` ("Variable")
- `dashboard.upcoming.enter_amount` ("Enter amount")
- `dashboard.upcoming.amount_required` ("Amount required")

## Out of scope

- Multi-currency support (storing the foreign currency, FX conversion). The user enters the final amount in their account currency at post time. If real multi-currency is wanted later, that's a separate, larger feature.
- Historical "average amount" suggestion for the input — could be a later polish (use the median of past posted transactions linked to this rule as the placeholder).

## Files touched

- New migration: column additions, validation trigger, updated `process_recurring_rules`, `account_balances_as_of`, `apply_recurring_rule_backfill`.
- `src/lib/finance.ts`
- `src/components/RecurringRulesCard.tsx`
- `src/components/UpcomingCard.tsx`
- `src/i18n/index.tsx`
