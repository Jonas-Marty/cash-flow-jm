## Goal

Build a foundation for automated unit / integration tests that verify the financial calculations powering the app — especially **net worth, projected net worths**, **account balances**, and **budget summaries** — so regressions in sums and filters get caught before they reach the UI.

## Where the math actually lives

Two distinct layers compute numbers, and they need different test strategies:

1. **Pure TypeScript helpers** (no I/O — easy to unit-test):
  - `src/lib/budgetSummary.ts` → `computeMonthTotals`, `planBalanceVerdict`, `monthVerdict`
  - `src/lib/finance.ts` → `groupSumByCurrency`, `formatPerCurrency`, `buildPendingMap`, `pendingDeltaForRow`, `fmtMoney`, `extractTags`, `monthKey`, `endOfMonthISO`, `endOfYearISO`, `todayISO`
  - `src/lib/amountFilter.ts` → `matchesAmount`
  - `src/lib/insights.ts` → `cv`, `stddev`, `linearRegression`, `topNWithOther`, `aggregateMonthly`, `buildProjection`, `monthRange`, `detectRecurringCandidates`, `normalizeMerchant`
  - `src/lib/transactionSchema.ts` / `pendingTransactionSchema.ts` → Zod normalization
  - `src/lib/fx.ts` → conversion helpers
  - `src/lib/usageScoring.ts`
2. **Database views & RPCs** (where net worth and budget actuals really come from):
  - Views like `account_balances`, `account_balances_as_of`, `category_month_rows`, `category_savings_balances_v2`, `reconciliation_summary`, `pending_impacts_for_month`
  - Compensation/match logic in `postCompensationForStatement`, `matchStatement`
  - These can only be verified by running real SQL against a Postgres instance with seeded data.

## Plan

### Phase 1 — Test runner setup (Vitest)

- Add dev deps: `vitest`, `@vitest/coverage-v8`.
- Add `vitest.config.ts` with the existing `@/*` path alias, `environment: "node"` (jsdom only for the few tests that need DOM), and `globals: true`.
- Add scripts to `package.json`:
  - `"test": "vitest run"`
  - `"test:watch": "vitest"`
  - `"test:coverage": "vitest run --coverage"`
- Create `src/__tests__/` and colocated `*.test.ts` files. Convention: pure-function tests sit next to the module (`src/lib/budgetSummary.test.ts`), integration tests live under `src/__tests__/integration/`.

### Phase 2 — Pure-function unit tests (the high-value, low-friction win)

Create the following test files. Each covers happy path + edge cases (empty inputs, zero/negative values, mixed currencies, missing pending entries):

- `src/lib/budgetSummary.test.ts`
  - `computeMonthTotals`: income/expense/savings categorization, pending deltas, projected vs allocated, savings rows always counted via `kind: "savings"`.
  - `planBalanceVerdict` / `monthVerdict`: each verdict bucket (`over`, `tight`, `ok`, `balanced`, `buffer`) at exact thresholds (±0.5, ±1, ±5%).
- `src/lib/finance.test.ts`
  - `groupSumByCurrency` with multiple currencies + missing accounts.
  - `formatPerCurrency` formatting per locale.
  - `buildPendingMap` aggregating signed deltas.
  - `pendingDeltaForRow` per kind (income/expense/savings).
  - `fmtMoney` rounding & negative formatting.
  - `extractTags` (hashtag parsing including dedupe).
  - Date helpers (`monthKey`, `endOfMonthISO`, `endOfYearISO`) including DST and month-end edge cases — pass an injected `Date` rather than relying on system clock.
- `src/lib/amountFilter.test.ts` — every op (`lt/lte/eq/gte/gt/around/any`), tolerance edges, zero target.
- `src/lib/insights.test.ts` — statistical helpers with known fixtures: `cv`, `stddev`, `linearRegression` (known slope/intercept), `aggregateMonthly`, `monthRange` (DST safe), `topNWithOther`, `detectRecurringCandidates` against a synthetic 12-month series.
- `src/lib/fx.test.ts` and `src/lib/usageScoring.test.ts`.
- `src/lib/transactionSchema.test.ts` / `pendingTransactionSchema.test.ts` — accept/reject matrix incl. transfer rules and `destination_amount`.

Target ≥ 90 % branch coverage for these files; they have no external deps.

### Phase 3 — Database integration tests (net worth & budget actuals)

This is the part the user really cares about: "does the sum match reality?". The sums come from SQL views, so we test SQL.

- Add `pg` (node-postgres) as a dev dep.
- Add a `src/__tests__/integration/db.ts` helper that:
  - Connects to a local Postgres using `TEST_DATABASE_URL` (the same one `docker-compose.yml` already starts).
  - Wraps every test in `BEGIN … ROLLBACK` for isolation.
  - Provides a `seed({ accounts, transactions, categories, statements, … })` factory that inserts minimal rows and returns their ids.
  - Provides a `setUserContext(userId)` helper that sets `request.jwt.claims` so RLS-bound views resolve `auth.uid()` correctly (or runs as `service_role` and filters manually).
- Add `vitest.integration.config.ts` with `testMatch: ["src/__tests__/integration/**/*.test.ts"]` and `npm run test:db`. Skip the suite automatically when `TEST_DATABASE_URL` is unset so contributors without Docker still get green pure-unit runs.

Write these integration tests:

1. **Net worth**
  - `account_balances.test.ts`: opening balance + N transactions (expense, income, transfer in/out, transfer with `destination_amount`) → assert `account_balances.balance` per account and the cross-account total.
  - `account_balances_as_of.test.ts`: same, but assert balance at three different `as_of` dates (before any tx, mid-period, after all).
  - Multi-currency: two accounts in different currencies → assert per-currency totals (no implicit conversion).
2. **Budgets**
  - `category_month_rows.test.ts`: categories with allocated budget + month override in `category_budgets` + actual transactions + a reallocation row → assert `allocated` and `spent_or_received` per category for the month.
  - `pending_impacts.test.ts`: seed a `pending_transactions` row → assert `fetchPendingImpactsForMonth` returns it on the correct month and only on that month, and that `buildPendingMap` + `computeMonthTotals` yields the expected projection.
  - Savings categories: ensure `kind = "savings"` rows feed `savingsTarget` and not `expenseAllocated`.
3. **Reconciliation / compensation**
  - Seed a statement with a known delta vs. computed balance → run `postCompensationForStatement` → assert the inserted compensation transaction's amount and sign, and that `account_balances` after equals `statement_balance`.

### Phase 4 — Make it part of the loop

- GitHub Actions / Lovable build: run `npm test` on every push (pure-unit only — no DB needed; fast).
- A separate optional job runs `npm run test:db` against `docker-compose up -d db` for the integration suite.
- README / `architecture.md` section: "How to add a test" with one pure example and one integration example.

## Out of scope

- React component / route tests (the user explicitly said no UI).
- E2E browser tests.
- Mocking the Supabase JS client to test the `fetch*` wrappers — real DB tests in Phase 3 give us higher confidence than a mock would.

## Deliverable order

1. Phase 1 (setup) + Phase 2 (`budgetSummary.test.ts`, `amountFilter.test.ts`, `finance.test.ts` core helpers) — one PR, immediate value.
2. Phase 2 remainder (`insights`, schemas, fx).
3. Phase 3 (DB harness + net worth tests, then budget tests, then reconciliation).
4. Phase 4 (CI wiring + docs).