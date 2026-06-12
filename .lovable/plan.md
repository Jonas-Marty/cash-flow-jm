## Problem analysis

### How "quarterly" works today

Quarterly is **not** the calendar quarter (Jan/Apr/Jul/Oct). It is anchored to the **month of `starts_on`** and steps by 3 months. So `starts_on = 2026-03-15` posts every Mar 15 / Jun 15 / Sep 15 / Dec 15. There is no UI hint that the anchor month is implied by `starts_on`, which is the root of "when does a quarter start?".

### Placeholders today (see `src/lib/placeholders.ts`)

All "period-ish" tokens are derived from the **transaction date** (`occurred_on`):

- `${quarter}`, `${monthOfYear}`, `${year}` → quarter/month/year of the posting date
- `${periodStart}` → `prevDate + 1 day`
- `${periodEnd}` → `date` (the transaction date)
- `${prevDate}` → previous occurrence's `effective_on`

So a quarterly statement booked on **May 3** for **Q1 (Jan–Mar)** renders `${quarter} = 2`, `${monthOfYear} = 5`, `periodStart = Jan 2` (prev occurrence + 1 day, off by one), `periodEnd = May 3`. None of these describe the period the statement is **about**.

There is also no way today to post "for the previous quarter": the only knob is to move the transaction date back, which then shifts every placeholder.

## What to change

### 1. Make the quarterly anchor explicit and visible

- Keep the existing semantics (anchor = month of `starts_on`, step 3 months) — no schema/RPC change.
- In the rule dialog, when `frequency = quarterly`, show an inline hint under the frequency select listing the four anchor months derived from `starts_on`, e.g. **"Posts in Mar · Jun · Sep · Dec"**. Same idea for yearly ("Posts in March each year").
- Add a one-click "Use calendar quarter" helper next to it that snaps `starts_on` to the first day of the nearest calendar-quarter month (Jan/Apr/Jul/Oct) while preserving the day-of-month rule.

This removes the "when does a quarter start?" ambiguity without changing stored data.

### 2. Introduce period-aware placeholders

Add a `reportingOffset` concept and new tokens that describe the **period the occurrence reports on**, independent of the transaction date.

Reporting period is defined as:

```
period length = frequency step (1 mo / 3 mo / 12 mo)
period end    = effective_on - reportingOffset
period start  = period end - (step - 1 month), snapped to month/quarter/year start
```

For the May-3-for-Q1 case the user adds `reportingOffset = 1 period` on the rule, so period = Jan 1 – Mar 31 regardless of the transaction date.

New tokens (all formattable like the existing date/number tokens):

| Token | Meaning |
| --- | --- |
| `${periodQuarter}` | 1–4, quarter of the reporting period |
| `${periodMonth}` | 1–12, month of the reporting period |
| `${periodYear}` | full year of the reporting period |
| `${periodSemester}` / `${periodTrimester}` | analogues for half/third of year |
| `${periodFrom}` / `${periodTo}` | first / last day of the reporting period (replaces the current off-by-one `periodStart`/`periodEnd`; the old tokens are kept as aliases for compatibility) |
| `${periodLabel}` | localized human label, e.g. `Q1 2026`, `März 2026`, `2026` — picked from frequency |

`${quarter}`, `${monthOfYear}`, `${year}` keep their current meaning (transaction-date based) so existing templates don't break. The new `period*` tokens are what a user types when they actually mean "the period this entry is about".

### 3. UI: reporting offset on the rule

Add a small "Reports on" select to the recurring-rule dialog (right under Frequency):

- **This period** (default, offset = 0) — today's behavior
- **Previous period** (offset = 1) — quarterly posted in April reports Q1
- **Custom offset…** — numeric input (-12…+12 months / 1 quarter / 1 year)

Stored as a single integer `reporting_offset` on `recurring_rules` (months count). Schema change is a single `ALTER TABLE`. Placeholder context gets a derived `periodEnd`/`periodStart` based on it.

### 4. Placeholder palette: previews + grouping

`PlaceholderPalette` (used by the rule dialog and the post-occurrence dialog) gets a new "Reporting period" group listing the new tokens with live previews computed from the draft's frequency + offset, so the user can see "Q1 2026" / "01.01.2026–31.03.2026" before saving.

## Technical details

Files touched:

- `src/lib/placeholders.ts` — extend `PlaceholderContext` with `periodStart`, `periodEnd`, `frequency`; add new tokens + `${periodLabel}` formatter; keep old tokens as aliases.
- `src/lib/finance.ts` — when building the interpolation context (both in `postOccurrence` split path and the post-occurrence dialog flow), compute `periodEnd = effective_on - reporting_offset months`, then derive `periodStart` from the rule's step. Pass `frequency` + offset through.
- `src/lib/finance.ts` types + `recurring_rules` row → add `reporting_offset: number` (default 0).
- `supabase/migrations/<ts>_recurring_reporting_offset.sql` — `ALTER TABLE public.recurring_rules ADD COLUMN reporting_offset integer NOT NULL DEFAULT 0;` plus update the create/update RPCs to accept it.
- `src/components/RecurringRulesCard.tsx` — anchor-month hint under Frequency, "Use calendar quarter" button, "Reports on" select, persist `reporting_offset`.
- `src/components/PostOccurrenceDialog.tsx` + `placeholders` palette — show the new "Reporting period" group with previews.
- `src/i18n/index.tsx` — new keys: `recurring.field.reports_on`, `recurring.reports_on.this/previous/custom`, `recurring.anchor_months_hint`, `recurring.use_calendar_quarter`, `placeholder.group.period`, plus token help strings.

Backwards compatibility: existing rules default `reporting_offset = 0`, so all current templates render exactly as before; only the new `${period*}` tokens are needed to take advantage of the feature.

## Out of scope

- Switching quarterly to a hard calendar anchor (would silently change existing rules). The "Use calendar quarter" helper is opt-in instead.
- Editing already-posted transactions when an offset is changed retroactively.
