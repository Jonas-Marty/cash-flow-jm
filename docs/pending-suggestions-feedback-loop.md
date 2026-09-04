# Pending suggestions — the feedback loop (not built yet)

Status: idea, deliberately deferred. This documents the intent so it is not
re-invented from scratch later.

## What exists

A pending transaction that arrives without a category gets one proposed
(`suggested_category_id`, `suggested_description`, `suggested_tags`,
`suggestion_source`, `suggestion_confidence`, `suggested_at`). The proposal
comes from the user's own history first (`suggestFromHistory` in
`src/lib/pendingSuggest.ts`) and from the configured AI connection for whatever
history cannot place (`src/utils/pending.enrich.server.ts`). The user's tap on
/pending promotes a suggestion into the real fields; nothing is applied on its
own.

## What is missing

Every confirmation on /pending is a labelled example of exactly the shape the
model is asked to produce:

    (notification text, amount, place) → (category, description, tags)

and every override — the user picked a different category than the one
suggested — is a *negative* example with the correct answer attached. Both are
thrown away today. The enrichment prompt only sees the generic 30-day context
briefing, which knows what the user usually does but not what they just
corrected.

## The loop

1. **Record the outcome.** On confirm, if the row carried a suggestion, store
   what happened to it: accepted as-is, edited, or replaced — and with what.
   The cheapest home is a small `pending_suggestion_outcomes` table keyed by
   the pending id; a jsonb payload on `ai_audit_logs` would also do.

2. **Feed the corrections back.** The enrichment prompt gets a short section
   of *recent overrides*, most recent first, capped at ~20:

       "TWINT CHF 12.50 an Bäckerei Hug" → not Groceries, the user chose Eating out

   This is far more targeted than the briefing, which lists frequent
   descriptions but never says "and the model got this one wrong last week".

3. **Measure before trusting.** With outcomes recorded, two numbers become
   available per source (`history` vs `ai`): acceptance rate and override
   rate. If history matches are accepted 95 % of the time and model guesses
   60 %, that is the argument for (4) — and for deciding whether the model is
   earning its tokens at all.

4. **Auto-apply, gated.** Once the numbers justify it, a per-user setting
   ("apply confident suggestions automatically") writes straight into
   `category_id` / `description` at insert time when *all* of these hold:

   - `suggestion_source = 'history'` (a merchant the user has categorised
     before — never a first-time model guess),
   - `suggestion_confidence >= 0.9` (at least three agreeing past entries, or
     two exact ones — see `confidence()` in `pendingSuggest.ts`),
   - the row still has no category of its own.

   The columns and the confidence scale were chosen so this needs a setting
   and one `if`, not a schema change. The suggestion columns stay filled even
   when auto-applied, so the row can still show "set automatically from
   history" and the outcome recording in (1) still works.

## Why it was deferred

There is no traffic yet to measure against. Building the loop before there
are a few hundred confirmed rows would mean tuning against anecdote. Steps 1
and 3 are cheap and could land early; 2 and 4 should wait for the numbers.
