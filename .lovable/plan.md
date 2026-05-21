## Goal

Add a compact, informational "Impact" block under the existing `TransactionPreview` on `/add` (and edit mode) that shows how saving the transaction will change:

- Source account balance
- Destination account balance (transfers only)
- Net worth (income/expense only — transfers between own accounts don't change it)
- The affected category's monthly envelope (one row per category; multiple rows when split)

Format per row: `Label · before XX.XX → after YY.YY (±delta)`, two columns on desktop, stacked on mobile. Subdued styling (muted text, small badges), no card chrome — just a tight section under the preview.

## Behavior

**Computation**

- Read balances via existing `fetchAccountBalances` (query key `["account_balances"]` — or add it; check what's already cached on Dashboard).
- Read this month's category rows via `fetchCategoryMonthRows(monthKey(date))`; the affected month follows the picked transaction date.
- Signed delta per account:
  - expense: `source -= amount`
  - income:  `source += amount`
  - transfer: `source -= amount`, `destination += destAmount ?? amount`
- Net worth delta: sum of per-account deltas (transfer between two of the user's accounts nets to ~0, except a cross-currency transfer where source/dest differ → show the FX-converted residual as the net-worth delta, reusing `useFxRates` + `convert`, same as Dashboard). Transfer feed are also cosidred.
- Category delta uses `spent_or_received` semantics already in `CategoryMonthRow`; show `remaining = allocated - spent` going from before → after. For splits, one row per slice category (collapse duplicates by summing).

**Edit mode**

- When `editId` is set, subtract the existing transaction's effect from the "before" so the displayed before is "balance without this transaction" and the after is "balance with the edited values". Reuse the loaded `editQ` data for the original amounts/category/accounts/date.

**Past / future date hint**

- If `date < today`: small muted note "Preview assumes this is already posted. The amount will land on its actual date in historical views."
- If `date > today`: "Future-dated. Account and budget impact shown as if posted now."
- No hint when date == today.

**Cross-currency note**

- When source and destination currencies differ, add a one-line hint that the net-worth delta uses today's FX rate.

**Empty / loading states**

- If amount is empty/invalid or no source account selected → hide the block (same trigger the existing preview uses for amount).
- If balances/category rows are still loading → render skeleton rows (1 line each) so layout doesn't jump.

## UI sketch

```text
Impact
  Account · UBS CHF        1'240.50 → 1'180.50   (−60.00)
  Net worth                12'430.10 → 12'370.10 (−60.00)
  Category · Internet      remaining 40.00 → −20.00 of 80.00
  ⓘ Future-dated. Shown as if posted now.
```

## Files to touch

- `src/routes/add.tsx`
  - Add two queries: `accountBalancesQ` and `categoryMonthQ` (keyed on `monthKey(date)`).
  - New `<ImpactPreview …/>` component rendered directly under `<TransactionPreview …/>` (around line 1523).
  - Pass `editOriginal` (from `editQ.data`) so edit mode can back out the old effect.
- `src/i18n/index.tsx`
  - New keys under `add.impact.*` (DE/EN): `title`, `account`, `networth`, `category_remaining`, `hint_past`, `hint_future`, `hint_fx`.

No backend, schema, or business-logic changes. Pure presentation, all data already exposed by existing helpers (`fetchAccountBalances`, `fetchCategoryMonthRows`, `useFxRates`/`convert`).

## Open questions

1. For the category row, prefer **(a) remaining** (`allocated − spent`, what most budgeting users watch) or **(b) spent** (`spent_or_received`)? Default in this plan: remaining, with `of <allocated>` suffix.
2. For non-budget categories (allocated = 0, e.g. income or savings), should the category row be hidden or shown as just `spent: before → after`? Default: show as spent-only without "remaining" framing.  
  
Go with the defaults in this plan.