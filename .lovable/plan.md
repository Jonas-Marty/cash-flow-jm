# Recurrence engine v2 — refactor plan

Replace the current `frequency + day_rule + reporting_offset_months` model with a strict interval-based model that treats execution and period as two symmetric, independently configurable series generated from the same primitive.

## Resolved rules (locked)

- Interval is a month multiplier 1..12. No weekly/daily cadence.
- Execution and period each have their own `DayRule` (`FixedDay | LastDay | FirstDay`) and, when `FixedDay`, a `DayOfMonth` 1..31. `FixedDay 31` snaps down in short months (28/29/30) but reverts to 31 in longer months.
- Weekend adjustment (`None | PreviousBusinessDay | NextBusinessDay`) applies only to the execution date, after `ExecutionDayRule`. Reporting period is anchored to the un-shifted `dueDate` and is unaffected.
- **Execution series** is generated from StartDate by stepping `interval` months and applying `ExecutionDayRule`, with the "skip anchors strictly before StartDate" filter (so the first exec is on or after StartDate).
- **Period series** is generated from StartDate's month/year by stepping `interval` months and applying `PeriodDayRule`, **without** the skip filter — the epoch is StartDate's month, and the nth exec pairs 1:1 with the nth period anchor (which may fall before StartDate).
- `PeriodOffset` ∈ [−3, +3] shifts the paired index by N intervals before formatting `${periodFrom}` / `${periodTo}`.
- `${periodTo}` = start of the following period minus 1 day (respects PeriodDayRule, e.g. `FixedDay(15)` → 14th of month).
- Variable-date override changes the effective transaction `${date}` only; `${dueDate}`, `${periodFrom}`, `${periodTo}` stay as computed.
- Variable amount and auto-post behave as today.

Scenario C canonical (Option 2, FirstDay):
- StartDate 10.05.26, Interval 3, PeriodRule FirstDay, execs 15.05, 15.08, 15.11
- Period series (FirstDay stepped from May 2026, no skip) → 01.05, 01.08, 01.11, 01.02.27, …
- Off 0: exec#1 → 01.05–31.07; exec#2 → 01.08–31.10
- Off +1: exec#1 → 01.08–31.10; exec#2 → 01.11.26–31.01.27
- Off −2: exec#1 → 01.11.25–31.01.26; exec#2 → 01.02–30.04.26

All 5 required test scenarios pass under this rule.

## Schema migration

Single migration, per user instruction no data-fidelity guarantee — best-effort mapping only.

### Enum swaps
- New enum `day_rule_v2 AS ENUM ('FixedDay','LastDay','FirstDay')`.
- New enum `weekend_adjust_v2 AS ENUM ('None','PreviousBusinessDay','NextBusinessDay')`.
- After column rewrite: drop old `recurring_frequency`, `recurring_day_rule`, `weekend_adjust` types; rename `_v2` to the canonical names.

### `public.recurring_rules` — column plan

Add (nullable at first, backfilled, then `SET NOT NULL`):
| Column | Type | Constraint |
|---|---|---|
| `recurrence_interval` | `smallint` | `NOT NULL`, `CHECK 1..12` |
| `execution_day_rule` | `day_rule_v2` | `NOT NULL` |
| `execution_day_of_month` | `smallint` | `CHECK 1..31`, required iff rule = FixedDay |
| `execution_weekend_adjustment` | `weekend_adjust_v2` | `NOT NULL DEFAULT 'None'` |
| `period_day_rule` | `day_rule_v2` | `NOT NULL` |
| `period_day_of_month` | `smallint` | `CHECK 1..31`, required iff rule = FixedDay |
| `period_offset` | `smallint` | `NOT NULL DEFAULT 0`, `CHECK -3..3` |

Best-effort backfill:
```
recurrence_interval  := monthly→1, quarterly→3, yearly→12
execution_day_rule   := fixed_day→FixedDay, end_of_month→LastDay, first_of_month→FirstDay
execution_day_of_month := day_of_month
execution_weekend_adjustment := none→None, before→PreviousBusinessDay, after→NextBusinessDay
period_day_rule      := execution_day_rule   (mirror)
period_day_of_month  := execution_day_of_month
period_offset        := clamp(round(reporting_offset_months / recurrence_interval), -3, +3)
```
Rows whose `reporting_offset_months` doesn't divide evenly by the new interval are logged into `audit_logs` with a `recurrence_v2_migration` marker so the user can find and fix them manually.

Drop after backfill: `frequency`, `day_rule`, `day_of_month`, `weekend_adjust`, `reporting_offset_months`.

Rewrite `validate_recurring_rule()` trigger against the new columns.

### Downstream tables
`recurring_occurrences`, `recurring_rule_slices`, `transactions` — no schema change. `due_on` = pre-shift, `effective_on` = post-shift; both survive as-is.

## SQL function rewrites

All `SECURITY DEFINER`, `search_path = public`.

- `series_step(anchor date, rule day_rule_v2, dom smallint, interval_months smallint, n int) → date` — core primitive. Returns the nth anchor (0-based) obtained by stepping `interval_months` from `anchor`'s month and applying `rule`. Handles FixedDay 29/30/31 clamp. No skip filter — callers apply one when needed.
- `execution_dates(rule_id, from_date, to_date) → SETOF (idx int, due date)` — enumerates `series_step` with execution params, filtered to `due >= starts_on` (skip filter) and returns 1-based indices for pairing.
- `weekend_shift(d date, adj weekend_adjust_v2) → date`.
- `period_bounds(rule_id, exec_due date) → (from date, to date)` — finds `n` = the 1-based index of `exec_due` in `execution_dates`, then `from = series_step(period_params, n − 1 + period_offset)` and `to = series_step(period_params, n + period_offset) − 1 day`. **No skip filter** on the period series.
- `process_recurring_rules(p_today date)` — rewritten around the helpers.
- `preview_recurring_rule(new-signature)` — takes all 7 new columns; drops the two existing overloads.
- `interpolate_template(p_template, p_due date, p_date date, p_period_from date, p_period_to date, p_run int, p_locale text)` — single signature. Drops both old overloads.
- `format_date_token(p_date, p_fmt, p_locale)` — extended with `Q` (1–4), `S` (1–2), `T` (1–3, Jan–Apr/May–Aug/Sep–Dec), `W` (ISO 8601 week).
- `apply_recurring_rule_backfill(...)` — signature unchanged, internals switched to new helpers.

Dropped tokens in `interpolate_template`: `${periodStart} ${periodEnd} ${periodLabel} ${periodMonth} ${periodQuarter} ${periodYear} ${periodSemester} ${periodTrimester} ${quarter} ${semester} ${trimester} ${today} ${prevDate} ${nextDate} ${monthOfYear} ${year} ${weekOfYear}`. Kept: `${date}`, `${dueDate}`, `${periodFrom}`, `${periodTo}`, `${runNumber}` with `Q/S/T/W` formatters.

## TypeScript

### `src/lib/recurrence.ts` (new)
Mirror of the SQL helpers so the UI can preview without a round-trip:
- `nextInSeries(anchor, rule, dom, intervalMonths, minDate)`
- `weekendShift(date, adj)`
- `executionDates(rule, from, to)` — generator
- `periodBoundsForExecution(rule, execDueDate)` → `{ from, to }`
- Full vitest coverage of every worked scenario in the spec.

### `src/lib/placeholders.ts` (rewrite)
- New `PlaceholderContext`: `{ date, dueDate, periodFrom, periodTo, runNumber, locale }`.
- Drop `computeReportingPeriod`, drop old `TOKENS` entries listed above.
- Add `Q/S/T/W` to `format_date_token` counterpart in TS.
- Emit a `console.warn` when interpolating a template that contains any dropped token; UI turns that into a warning banner.
- Update `src/lib/placeholders.test.ts`.

### `src/lib/finance.ts`
`RecurringRule` type → drop `frequency, day_rule, day_of_month, weekend_adjust, reporting_offset_months`; add the 7 new fields. Update any `select("*")` mappers.

### UI
- `src/components/RecurringRulesCard.tsx` — replace Frequency select with Interval select (`1 Monthly, 2, 3 Quarterly, 4 Trimesterly, 5, 6 Semesterly, 7, 8, 9, 10, 11, 12 Yearly`). Split the current day-rule block into two mirrored sections **Execution** and **Period**, each with rule + conditional day-of-month; Execution gets weekend adjust, Period gets offset (−3…+3). Live preview of next 3 executions with `dueDate → date` and each `periodFrom – periodTo` using `src/lib/recurrence.ts`. Placeholder palette pruned; Q/S/T/W chips added. Warning banner when a saved template still references a dropped token.
- `src/components/PostOccurrenceDialog.tsx` — build `PlaceholderContext` from occurrence + rule via `periodBoundsForExecution`, not from `frequency+offset+anchorMonth`.
- `src/components/UpcomingCard.tsx`, `src/components/insights/ProjectionTab.tsx`, `src/routes/privacy.tsx`, `src/i18n/index.tsx` — swap field references and labels.
- `src/routes/help.tsx` — rewrite the "recurring transactions" section to describe the new model.

## Tests

- New `src/lib/recurrence.test.ts` covering:
  - All Execution Date Examples.
  - Scenarios A, B, C in full (Option 1 rule for C).
  - The five Required Test Scenarios.
  - FixedDay 31 across Feb (clamp) then Mar (revert).
  - Weekend adjust across month boundary (LastDay Feb Sat → prev Fri stays Feb).
  - PeriodOffset ±3 boundary.
- Update `src/lib/placeholders.test.ts` for new context shape and Q/S/T/W formatters (year boundary ISO week, Q4 → Q1, T3 edge, S1/S2 split at 01.07).

## Rollout (single PR)

1. Migration (schema + backfill + SQL functions + validate trigger).
2. `bun x supabase gen types` regen (implicit).
3. `src/lib/recurrence.ts` + tests.
4. `src/lib/placeholders.ts` rewrite + tests.
5. `src/lib/finance.ts` type update.
6. UI: `RecurringRulesCard`, `PostOccurrenceDialog`, `UpcomingCard`, `ProjectionTab`, i18n, help page.
7. Manual smoke: create rule, run `process_recurring_rules` via the existing `api.public.process-recurring` endpoint, verify occurrences and period tokens in posted transactions.

## Out of scope

- Weekly / daily cadence.
- Rewriting placeholder strings inside existing `recurring_rules.description` / `note` (user fixes manually).
- Recomputing already-materialised `recurring_occurrences` (dates in the past stay as-is).
- Adjusting historical transactions posted under the old engine.
