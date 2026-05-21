## Current state (answering your questions first)

**1. The "Choose below…" hint with no button.**
The backfill choice (3 radio options: Don't create / Post now / Pending) **does exist** in `RecurringRulesCard.tsx` (lines 789–827), but it is gated on `!draft.id` — i.e. only shown when creating a **new** rule. When you edit an existing rule, the hint text in the preview panel ("Start date is in the past. Choose below…") still renders, but the radio group above it is hidden. That's the bug you saw.

**2. How edited rules currently behave.**
On save of an existing rule (lines 269–280):

- All `pending` occurrences for the rule are deleted.
- `process_recurring_rules` is called → it regenerates pending occurrences from `starts_on` forward, and auto-posts any whose `effective_on <= today` if `auto_post = true`.
- `posted` occurrences (those linked to real transactions) are **kept** untouched.

So today, editing a rule whose `starts_on` is in the past and that has `auto_post = true` can silently re-create missing past transactions — without telling the user. Editing a non-split rule into a split rule doesn't touch already-posted occurrences (good), but the next `process_recurring_rules` run will fan out any *pending* occurrence into multiple split transactions — including past ones if `auto_post` is on.

**3. Variable amount / variable date / auto-post effects on save.**

- `is_variable_amount` or `is_variable_date` → forces `auto_post = false` on save (line 259). Pending occurrences are created but never auto-posted; user must confirm them via the Upcoming card.
- `auto_post = true` (and neither variable flag) → `process_recurring_rules` will post past-due pending occurrences immediately.

There is currently no UI surface that tells the user "saving this will create N past transactions and M pending ones."

---

## Plan

### Step 1 — Show backfill choice when editing too (when relevant)

Change the gating from `!draft.id` to "starts_on is in the past **and** there is no posted history for this rule yet". Reason: once a rule already has posted occurrences, full backfill UX gets confusing — the user is really asking "fill the gap since last posted". For the gap case we surface a tighter set of options:

- **New rule, past start** → existing 3 options (None / Post now / Pending) — unchanged.
- **Edited rule with no posted occurrences yet, past start** → same 3 options.
- **Edited rule with posted occurrences, gap between last posted and today** → 2 options: *Don't fill the gap* (default) / *Create gap entries as pending*. No silent auto-post. Auto-posting requires `auto_post = true` and the rule's normal mechanism on the next run; the gap UI explicitly opts in.
- **Edited rule, no past gap** → no backfill block, no past hint.

Fix the misleading "Choose below…" preview hint: only render it when the radio block above is actually visible.

### Step 2 — Pre-save impact summary

Add a small "What will happen on save" block above the Save button, recomputed live from the draft. It enumerates:

- **N past transactions auto-posted now** (only if `auto_post && !is_variable_amount && !is_variable_date` and there are past pending dates that would result).
- **N past entries created as pending** (if backfill = pending, or auto-post is off).
- **N future pending occurrences scheduled** through the 14-month horizon.
- **For edits**: "X existing pending occurrences will be regenerated; Y posted transactions stay untouched."
- **For split**: "Each occurrence will be split into K transactions sharing a split group."
- **Variable amount / variable date** → "Each occurrence requires manual confirmation before posting" (so the user understands why `auto_post` was forced off).

Numbers come from the same `previewRecurringRule` query the panel already runs, plus a cheap count query for existing pending/posted occurrences on edit. No new RPC needed.

### Step 3 — Confirmation gate for destructive/surprising saves

When the impact summary says "N past transactions will be auto-posted now" with N ≥ 1, the Save button opens a small confirm dialog listing the dates and total amount, with Cancel / Confirm. This prevents the silent-creation footgun for both new and edited rules. Triggered identically when toggling `auto_post` from off → on on an existing rule whose `starts_on` is in the past.

### Step 4 — Split-conversion safety (edits only)

When the user flips `is_split` on for an existing rule, the impact summary explicitly calls out: "Splits will only apply to upcoming occurrences. Existing posted transactions are not retroactively split." Already true in code (posted occurrences aren't touched). No behavior change needed beyond the user-facing message.

### Step 5 — Reflect live changes for date/interval/variable/auto-post

PreviewPanel already re-queries on `frequency / day_rule / day_of_month / weekend_adjust / starts_on / ends_on` changes. Extend the impact summary's dependency list to also include `is_variable_amount`, `is_variable_date`, `auto_post`, `is_split`, and (on edit) the rule id, so the user sees the consequence the moment they toggle any of these.

### Step 6 — i18n

Add new labels (DE + EN):

- `recurring.impact.title`
- `recurring.impact.auto_post_past` ({n}, {sum})
- `recurring.impact.pending_past` ({n})
- `recurring.impact.future` ({n})
- `recurring.impact.regenerated` ({pending}, {posted})
- `recurring.impact.split_note` ({k})
- `recurring.impact.variable_note`
- `recurring.backfill.gap_title`, `recurring.backfill.gap_none`, `recurring.backfill.gap_pending`
- `recurring.confirm_post_past.title` / `.body` / `.confirm`

Drop / re-scope `recurring.preview.note_past` so it only shows when the radio block is hidden but the start is still in the past (defensive).

---

## Technical notes

- Files: `src/components/RecurringRulesCard.tsx` (gating + impact summary + confirm dialog), `src/i18n/index.tsx` (new labels). No SQL changes.
- New cheap query on edit only: count of `recurring_occurrences` where `rule_id = draft.id` grouped by `status` — used for the "regenerated / kept" line and for the gap-only branch.
- Confirm dialog reuses existing `Dialog` primitives — no new components.
- No change to `process_recurring_rules` behavior; the existing semantics (delete pending → regenerate → auto-post past-due if `auto_post`) is fine as long as the user has explicitly confirmed it.

---

## Open question

For the "edited rule with no posted occurrences yet" case, two options:

A. **Same 3 backfill options as new rule** (None / Post now / Pending) — symmetric, simplest mental model.
B. **Only allow Pending or None** for edits — assumes that auto-creating past real transactions on an edit (rather than a fresh creation) is almost always a mistake.

I'd default to **A** because nothing has been posted yet, so semantically it's identical to "new". Confirm A, or pick B.

I confirm A