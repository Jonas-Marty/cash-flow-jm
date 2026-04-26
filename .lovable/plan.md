
## Goal

Rename the **payee / Empfänger** concept to **description / Beschreibung** end-to-end so it matches your "What?" mental model (e.g. *"Eis go Zieh mit Florian Bär"*, *"Lovable 1 Month Subscription"*). `note` and tags remain unchanged.

## 1. Database migration

Single migration that renames the column on both tables and updates all database functions that reference it.

- `ALTER TABLE public.transactions RENAME COLUMN payee TO description;`
- `ALTER TABLE public.recurring_rules RENAME COLUMN payee TO description;`
- Recreate functions referencing the old name with the new column:
  - `apply_recurring_rule_backfill` — INSERT into `transactions(... description ...)` from `r.description`
  - `process_recurring_rules` — same INSERT update

`category_month_spending` and `account_balances_as_of` don't reference `payee`, so no change there. Suggestion: also re-run the project's auto-generated `src/integrations/supabase/types.ts` (handled automatically after the migration).

## 2. Code rename (`src/lib/finance.ts` and friends)

- Rename `Transaction.payee` → `Transaction.description`
- Rename `RecurringRule.payee` → `RecurringRule.description`
- Update `postOccurrence` to insert `description` from the rule
- Keep `extractTags()` exactly as is (it parses `note`, untouched)

## 3. Suggestion engine

The whole suggestion system is keyed on this field; the logic stays identical, only names change:

- `src/lib/suggestions/types.ts` → rename `payee` → `description` in `SuggestionContext` and `TransactionDraft`
- `src/lib/suggestions/providers/payee.ts` → rename file to `description.ts`, export `descriptionProvider`, update `id: "description_match"`, source `"description_match"`
- `src/lib/suggestions/providers/history.ts` → use `description` field
- `src/lib/suggestions/registry.ts` → import + register the renamed provider
- `src/lib/suggestions/useSuggestions.ts` → propagate field rename

## 4. Components

- **Rename** `src/components/PayeeAutocomplete.tsx` → `DescriptionAutocomplete.tsx`, export `DescriptionAutocomplete`. Internally it reads `tx.description` to build the suggestion list.
- `src/components/SuggestionRow.tsx` — rename any `payee` references
- `src/components/DayPreview.tsx` — display `description` instead of `payee`
- `src/components/RecurringRulesCard.tsx` — form field `payee` → `description`
- `src/components/UpcomingCard.tsx` — display label updates (no field-name impact since it reads from rule)

## 5. Routes / pages

- `src/routes/add.tsx`
  - State variable `payee` → `description`
  - `<PayeeAutocomplete>` → `<DescriptionAutocomplete>`
  - Label uses `tr("add.description")`
  - Insert payload uses `description: description.trim() || null`
  - Touched-key tracking: `"payee"` → `"description"`
- `src/routes/transactions.tsx` — display + filter use `description`
- `src/routes/envelopes.tsx` — display use `description`
- `src/routes/index.tsx` — display use `description`

## 6. i18n labels (`src/i18n/index.tsx`)

Replace `add.payee`, `add.payee_placeholder`, and any other `*.payee*` keys with `*.description*` equivalents. New copy:

| Key | EN | DE |
|---|---|---|
| `add.description` | Description | Beschreibung |
| `add.description_placeholder` | What was it? e.g. "Coffee Quadra", "Dinner with Anna" | Was war es? z. B. „Kaffee Quadra", „Znacht mit Anna" |
| `add.description_optional` | Optional | Optional |

Recurring-rules card label: "Payee" → "Description / Beschreibung".

## 7. Architecture notes

- Update `architecture.md` to reflect the rename and the new mental model ("free-text description / 'Was?' field, not a strict counterparty").

## What stays unchanged

- `note` field — still free-form, still source of `#tags`
- `transaction_tags` table + `sync_transaction_tags` trigger
- `TagChips` component, suggestion sublabels showing tag counts
- All balance math, RLS, recurring schedule logic
- Existing data — `RENAME COLUMN` preserves all values; no data migration needed

## Out of scope / not touched

- No new column added
- No change to how the field is used by suggestions (just renamed)
- No UI restructuring beyond the label change

## Risk / rollback

- `RENAME COLUMN` is reversible with a counter-migration.
- The `types.ts` regeneration happens automatically after the migration runs; any code still referencing `.payee` will fail typecheck immediately, making missed spots easy to catch.
