## Goal

Extend recurring rules so that, before posting a non-auto-post occurrence, the user can:

1. Edit the **transaction date** (occurred_on).
2. Edit the **description**, with support for **placeholder interpolation** (date tokens, period boundaries, counters).
3. See **resolved placeholders in the preview** befor posting and during editing and creating reccurong transactions.
4. Use a **separate "format locale"** (independent of UI language) for month/day name rendering.

---

## 1. Placeholder syntax

Use `${name}` and `${name:format}`, with familiar JS-style escaping (`$$` → literal `$`). Chosen because:

- It mirrors JS template literals (already familiar).
- Doesn't collide with `#tags` already used in notes.
- Curly braces let format strings contain `:`, `.`, `-`, spaces.

Example:

```
Electricity ${periodStart:dd.MM.yyyy} – ${periodEnd:dd.MM.yyyy}
Rent ${date:MMMM yyyy}
Q${quarter} ${date:yyyy} VAT
Subscription #${runNumber} (${date:MMM yyyy})
```

### Date tokens (each accepts an optional `:format`)


| Token         | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `date`        | Effective transaction date (= occurred_on at post time)                                                        |
| `dueDate`     | Original due date (before weekend adjustment)                                                                  |
| `prevDate`    | Effective date of the previous occurrence of this rule (or `starts_on` if none)                                |
| `nextDate`    | Effective date of the next scheduled occurrence                                                                |
| `periodStart` | Day after `prevDate` — i.e. start of the period this occurrence covers. For the first occurrence: `starts_on`. |
| `periodEnd`   | `date` itself — end of the period this occurrence covers.                                                      |
| `today`       | Real "now" at the moment of posting                                                                            |


### Number/counter tokens (no format, but `:00` style padding supported)


| Token         | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `runNumber`   | 1-based count of posted+skipped occurrences of this rule including the current one |
| `quarter`     | 1–4, calendar quarter of `date`                                                    |
| `semester`    | 1–2, half-year of `date`                                                           |
| `trimester`   | 1–3, third-of-year of `date`                                                       |
| `weekOfYear`  | ISO week number of `date`                                                          |
| `monthOfYear` | 1–12                                                                               |
| `year`        | Full year                                                                          |


### Format strings

For date tokens, format follows date-fns `format()` syntax. Highlights:

- `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss`, `SSS`
- `MMM` (Jan, Feb…), `MMMM` (January…)
- `ddd` is not date-fns standard → we map `ddd`→`EEE` and `dddd`→`EEEE` before calling date-fns, so users can use the convention they asked for.
- Default (no format given) = ISO `yyyy-MM-dd`.
- A literal `:` inside the format works because parsing is bracket-bounded by `{}`.

For numeric tokens, `:00`, `:000` mean zero-padding width.

### Format locale

New setting `format_locale` (text, default = current `language`). Used **only** for month/day names in placeholders. UI language stays separate. Initial supported locales: `de`, `en` (extendable). Stored on `settings` table.

---

## 2. UI changes

### a) Settings → "Format locale" select

In `src/routes/settings.tsx`, add next to "Date format":

- Label: "Format locale for placeholders"
- Options: German / English (mirror existing language list).

### b) Recurring rule edit dialog (`RecurringRulesCard.tsx`)

Below the description input add a small **"Available placeholders"** help block (collapsible) listing tokens with one-line examples — purely informational.

Extend `PreviewPanel` to also resolve and display the **rendered description** for each preview row, given the rule's current draft. Rendered output is shown in muted text under each date row:

```
14.05.2026   [future]
Electricity 15.04.2026 – 14.05.2026
```

This requires the preview to know `prevDate` per row → trivially derived from previous row's `effective_on` (or `starts_on` if first). `runNumber` in preview = index+1.

### c) "Post occurrence" dialog (NEW)

Currently `UpcomingCard` posts in one click. Change behavior:

- **Auto-post rules** keep working as today (no UI change; happens server-side via `process_recurring_rules`).
- **Non-auto-post rules** (manual): clicking **Post** opens a small dialog with:
  - **Date** (DateInput, defaults to `effective_on`)
  - **Description** (Input, defaults to rule's `description`, with placeholder hint)
  - **Note** (Input, defaults to rule's `note`)
  - **Amount** field (only when `is_variable_amount`, same as today)
  - **Live preview** of the resolved description below the description field
  - Buttons: Cancel / Post

The dialog uses the same `interpolate()` function as the preview. On Post, it calls `postOccurrence(o, { occurred_on, description: resolved, note: resolvedNote, amount? })` — `postOccurrence` already accepts `description`, `note`, `occurred_on`, `amount` overrides.

The user passes the **already-resolved** strings to `postOccurrence`, so the saved transaction has the literal expanded text (no surprise re-render later).

---

## 3. Technical: interpolation engine

New file `src/lib/placeholders.ts`:

```ts
export interface PlaceholderContext {
  date: Date;          // effective / occurred_on
  dueDate: Date;
  prevDate: Date;      // or starts_on for first
  nextDate: Date | null;
  today: Date;
  runNumber: number;
  locale: Locale;      // date-fns locale chosen via settings.format_locale
}

export function interpolate(template: string, ctx: PlaceholderContext): string;
export function describeTokens(): { token: string; help: string; example: string }[];
```

Parser: single regex `/\$\$|\$\{([a-zA-Z]+)(?::([^}]*))?\}/g`, with `$$` escaping to `$`.

Format normalization: replace `dddd`→`EEEE`, `ddd`→`EEE` (bare, not inside `[...]` literal escape — date-fns treats `[...]` as literals).

Derived values:

- `periodStart` = day after `prevDate` (or `starts_on` for first occurrence)
- `periodEnd` = `date`
- `quarter` = `Math.floor(month/3)+1`
- `semester` = `month < 6 ? 1 : 2`
- `trimester` = `Math.floor(month/4)+1`
- `weekOfYear` = `getISOWeek(date)`

Unknown tokens render as the literal `${token}` (so users see typos).

---

## 4. Database / schema

- Add column `settings.format_locale text not null default 'de'`.
- No other schema change. Override values are passed transiently to `postOccurrence`; they end up in `transactions.description`/`note`/`occurred_on` which already exist.

(Migration file under `supabase/migrations/`.)

---

## 5. Files touched

- **NEW** `src/lib/placeholders.ts` — interpolation + token catalogue.
- **NEW** `src/components/PostOccurrenceDialog.tsx` — manual-post editor.
- `src/components/UpcomingCard.tsx` — open dialog for non-auto-post rules instead of one-click post; keep skip and amount-only path for backward compat. Keep auto-post badge behavior.
- `src/components/RecurringRulesCard.tsx` — small placeholder hint under description; extend `PreviewPanel` to compute `prevDate` per row and render resolved description per occurrence.
- `src/routes/settings.tsx` — Format locale selector.
- `src/lib/finance.ts` — extend `Settings` type with `format_locale`.
- `src/i18n/index.tsx` — new keys (placeholder labels, dialog labels, format-locale label, helper for available locales).
- `architecture.md` — new short section "§3.x Placeholders in recurring rules" explaining tokens, scope creep, and why model still holds.
- Migration: `settings.format_locale`.

---

## 6. Challenge: are recurring rules still the right model?

You're right that this stretches "recurring transaction" toward "recurring planned event". But the model still works because:

- **Schedule generation is unchanged.** The cadence + day rule + weekend adjust + frequency still uniquely produce due dates. Placeholders only affect the *content* of the resulting transaction, not when it fires.
- **Ground truth stays in `transactions`.** After post, the resolved string is stored verbatim — no template re-evaluation later, no drift.
- **Variable-amount rules already broke the "fixed" assumption.** Editable date + description on manual post is the natural next step on the same axis: fixed schedule, variable content. Auto-post rules remain truly fixed.
- **Period semantics fall out of the cadence**, not new metadata. `periodStart = prevDate+1day, periodEnd = date` works deterministically for monthly/quarterly/yearly without introducing a separate "billing period" concept.

Where it would start to break (and we should *not* go there in this change):

- Rules with **multiple bills per period** (e.g. weekly within a month).
- Rules where the period is **decoupled from the cadence** (post in May for Jan–Mar). That would need an explicit `period_start_offset`/`period_end_offset` per rule — out of scope.
- **Auto-post + placeholders** is fine technically (server-side rendering at post time), but for the first iteration we can keep auto-post using the raw description as today, and only resolve in the manual post dialog and preview. If you want auto-post resolution too, add the same `interpolate` server-side later (Postgres function) — flagged as a follow-up, not in this plan.

If the answer to either of those becomes "yes" in the future, we'd promote the rule into a separate "PlannedExpense"/"BillingSchedule" entity. For now, extending `recurring_rules` is the right call.

---

## 7. Out of scope (explicit)

- Server-side placeholder resolution for auto-post rules (kept as raw text for now).
- Internationalization of placeholder *names* (`${date}` stays English-keyword).
- Format locales beyond `de` and `en` (easy to add later).