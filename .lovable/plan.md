
## Goal

Support a recurring rule like "pay internet subscription, half is reimbursable from girlfriend" as **one rule** that produces a split transaction on post, plus allow the effective date to vary per occurrence (mirror of the existing `is_variable_amount` pattern).

## Current model recap

- `recurring_rules`: single-row template (type, amount or `is_variable_amount` + `estimated_amount`, one `category_id`, one `description/note`, scheduling, `auto_post`).
- `recurring_occurrences`: schedule rows with `due_on` / `effective_on`. `postOccurrence` inserts **one** `transactions` row and links it.
- `transactions`: already supports `split_group_id` (N sibling rows) and per-row `is_reimbursable` + `reimbursable_counterparty/reason`. The add form already builds splits this way.

So the storage shape for splits already exists on the transaction side — what's missing is a **template** for slices on the rule side, and a **per-occurrence variable date** flag.

## Recommendation: extend the single rule (Option A), not two rules

Two separate rules (Option B) is simpler but:
- loses the conceptual link ("this slice exists because of that subscription"),
- duplicates schedule/account/description maintenance,
- can't auto-mark one slice reimbursable with the right counterparty,
- and the reimbursement settlement model already links the repayment back to the original transaction — but only if that transaction exists as a single reimbursable slice. Two rules can't express "half of this specific posting is owed back".

Go with Option A. Keep Option B available implicitly (user can still create two rules manually if they prefer).

## Changes

### 1. Schema (migration)

New table `recurring_rule_slices` — one row per slice on a split-capable rule:

```text
recurring_rule_slices
  id                       uuid pk
  rule_id                  uuid fk → recurring_rules(id) on delete cascade
  sort_order               int  not null default 0
  amount                   numeric        -- null when rule.is_variable_amount
  amount_ratio             numeric        -- optional: e.g. 0.5 to derive from total on variable rules
  category_id              uuid null
  description              text null
  note                     text null
  is_reimbursable          boolean not null default false
  reimbursable_counterparty text null
  reimbursable_reason       text null
  created_at / updated_at  timestamptz
```

RLS: same `user_id = auth.uid()` shape via parent `recurring_rules`.

New columns on `recurring_rules`:
- `is_split` boolean not null default false — when true, slices table drives posting and top-level `category_id` / `description` / `note` become the "fallback" / header only.
- `is_variable_date` boolean not null default false — when true, force `auto_post = false` (mirrors how `is_variable_amount` already forces it).

Constraints / validation trigger:
- if `is_split` then ≥2 slice rows must exist;
- if not `is_variable_amount`, sum(slice.amount) must equal `rule.amount`;
- if `is_variable_amount`, slices must use `amount_ratio` (sum = 1.0) **or** fixed `amount` values that are reconciled at post time.

### 2. Posting logic (`postOccurrence` + RPC `process_recurring_rules`)

Today `postOccurrence` inserts a single transaction. Update it so:

- If `rule.is_split = false`: unchanged.
- If `rule.is_split = true`:
  - Generate a `split_group_id` (uuid).
  - For each slice, compute slice amount:
    - fixed-amount rule → `slice.amount`,
    - variable-amount rule with `amount_ratio` → `round(total * ratio, 2)` (last slice absorbs rounding diff),
    - variable-amount rule with fixed slice amounts → use them; validate sum == entered total.
  - Insert N transaction rows with shared `split_group_id`, `recurring_rule_id = rule.id`, per-slice `category_id`, `description`, `note`, `is_reimbursable`, `reimbursable_counterparty`, `reimbursable_reason`, `reimbursable_status = 'open'` when reimbursable.
  - Update the occurrence with `transaction_id = <first slice id>` (or extend `recurring_occurrences` with `split_group_id uuid` — cleaner; add the column in the same migration).

Auto-post path in the SQL function `process_recurring_rules` must do the same branching. Variable-amount **or** variable-date rules stay non-auto-postable (skipped by auto-post, surfaced in Upcoming).

### 3. Post dialog (`PostOccurrenceDialog`)

- Date input is already editable — only needs to become **required to confirm** when `rule.is_variable_date` (small hint text).
- When `rule.is_split`:
  - Render a slices table (read-only categories/descriptions, editable amount column only when `is_variable_amount`).
  - Show running total vs entered amount with a delta indicator (reuse logic from `add.tsx` split section).
  - Show reimbursable badge per slice.

### 4. Rule editor (`RecurringRulesCard`)

- Add "Split into multiple transactions" toggle (`is_split`). When on:
  - Show a slices editor (amount, category, description, reimbursable toggle + counterparty/reason) — visually reuse the existing split UI from `add.tsx` (extract into a shared `<SplitSlicesEditor>` component in `src/components/`).
  - Hide the rule-level category/description (or label them as "fallback").
- Add "Variable effective date" toggle (`is_variable_date`). When on, disable `auto_post`.

### 5. Types & helpers

- Extend `RecurringRule` interface with `is_split`, `is_variable_date`, `slices?: RecurringRuleSlice[]`.
- Add `RecurringRuleSlice` interface mirroring the table.
- Update `fetchRecurringRules` / `fetchPendingOccurrences` selects to include `slices:recurring_rule_slices(*)`.

### 6. Tests (Vitest, pure functions only)

Add `src/lib/recurringSlices.test.ts` covering:
- ratio-based slice amount derivation with rounding remainder absorbed by last slice,
- fixed-slice validation (sum mismatch rejected),
- reimbursable flag carried per slice,
- variable-date rule forces `auto_post = false`.

Extract the math into `src/lib/recurringSlices.ts` so it's testable without DB.

## Out of scope

- Linking the **girlfriend's Twint repayment** back to the reimbursable slice is already handled by the existing reimbursable settlement flow — no changes needed there.
- No UI for "convert two existing rules into one split rule" migration; users do that manually.

## Rollout order

1. Migration (table + columns + validation trigger + update to `process_recurring_rules` SQL).
2. `src/lib/recurringSlices.ts` + tests.
3. `RecurringRule` types + fetchers.
4. `postOccurrence` split branch.
5. Extract `SplitSlicesEditor` from `add.tsx`.
6. Update `RecurringRulesCard` (toggles + editor).
7. Update `PostOccurrenceDialog` (slice table + variable-date confirmation hint).
8. i18n strings (de/en) for new labels.
