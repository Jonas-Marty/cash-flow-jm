# Give the assistant real data up front (context briefing)

Today the assistant starts every chat blind: it only knows today's date, your currency and language. Everything else — which accounts exist, which categories, what you normally spend — requires a tool call, and models often skip those calls or guess. The result is generic proposals.

The fix: build a compact **context briefing** on the server and paste it into the system prompt of every chat turn, so the model already *sees* your real accounts, categories and recent behaviour before it writes a single word.

## What the briefing contains

Assembled fresh per chat request from the database (never invented, never cached longer than a few minutes):

1. **Accounts** — id, name, currency, and whether it's the default. Compact one-line-each list.
2. **Categories** — id, name, group, kind (expense / income / savings envelope), monthly budget, and this month's actual.
3. **Tags** — the tags you actually used in the last 6 months, with usage counts, capped to the top ~40.
4. **Recent activity (last 30 days, summarised — not raw dumps)**:
  - Per account: how many transactions, which categories dominate, typical amount range.
  - Per category: count, median amount, the tags most often used with it.
  - The most frequent descriptions (e.g. "Migros", "Coop") with their usual category, account and tag.
5. **A short list of the ~15 most recent transactions** verbatim (date, description, amount, account, category, tags) so the model can pattern-match on wording.

All of it rendered as terse plain text / small tables — target under ~2,000 tokens so it works with local models too.

## Why this beats a `suggest_defaults` tool

A tool returns a statistical ranking; the model has to trust a black box. With the briefing the model sees the actual rows and can reason: "gift cards on 'Coop Geschenkkarten' were always Groceries with #coop, and the last three were 100.00 — so propose Groceries, #coop, and leave the amount to the user." It also stops the model from inventing account or category names, and cuts a round-trip (fewer tool calls = faster, cheaper, works better with weaker local models).

The existing read tools stay — they're still the right way to answer "what did I spend in March".

## Prompt rules added

- Use the briefing for defaults when prefilling `prepare_add_transaction`; only use IDs that appear in it.
- The briefing is a snapshot of the last 30 days — for any question about totals, other periods or exact figures, still call the tools.
- Prefer the pattern of the most similar recent transactions over a generic guess; leave a field blank instead of guessing wildly.

## Cost / size control

- A setting in **Settings → AI** ("Include recent activity in prompt": Off / Compact / Full) so you can shrink the briefing for small local models. Default: Compact.
- Hard caps on every list (accounts all, categories all, tags 40, descriptions 25, recent transactions 15), amounts rounded, no notes/IOU details included.

## Technical notes

- New `src/lib/ai/contextBriefing.ts`: pure formatter turning fetched rows into the prompt block (unit-testable).
- New server helper in `src/utils/ai.server.ts` (or a `contextBriefing.server.ts`) that reads accounts, categories, recent transactions and tags via the request-scoped Supabase client (RLS applies), aggregates in JS, and returns the text block.
- `buildSystemPrompt` gains an optional `briefing` field appended under a `## Your data (snapshot)` heading; `chat()` in `src/utils/ai.functions.ts` fills it alongside the existing settings lookup.
- Briefing detail level stored in the existing `settings` row (new small column or reuse the AI settings JSON, whichever the schema already offers).
- Attachment/statement flows are untouched.
- Bump `package.json` patch version.

Make the "Include recent activity in prompt": Off / Compact / Full configurable per AI Connection, i might like different settings per model.