# More AI context, smarter lookups, and guessed fields for statements

Three related improvements to how the assistant sees your data.

## 1. New "X-large" context size

Today each AI connection can send Off / Compact / Full context. A fourth level **X-large** is added. Its main difference is that it sends more complete past transactions as examples, not just aggregated descriptions. The LLM sees each example in context (date, description, amount, account, category, tags), so it can pattern-match wording and classification decisions more accurately.

| Level | Window | Tags | Frequent descriptions | Recent rows verbatim |
|---|---|---|---|---|
| Compact | 30 days | 25 | 15 | 10 |
| Full | 30 days | 40 | 25 | 15 |
| X-large | 180 days | 80 | 60 | 60 |

X-large also keeps the per-description examples richer (up to 3 example rows per frequent description, instead of only the aggregate line), so a strong model can pattern-match wording, account, category and tags from real history. It is meant for large-context cloud models; the hint text in Settings says so.

## 2. Always allow the model to look further back

Independent of the chosen level, the snapshot is only a window. The system prompt gets an explicit rule:

- The snapshot is a partial window. If no entry in it resembles what the user described, call `list_transactions` with a `search` term (merchant/keyword) before proposing a category, description or tags.
- Only fall back to a generic guess after that search returns nothing.

`list_transactions` gets tag data included in its result and its description is reworded to advertise it as the "find similar past transactions" tool, so weaker models pick it.

## 3. Statement import: guess description, category and tags

When a statement is analysed, every line that stays **unmatched** goes through a classification pass using the same context briefing:

- Input: the raw line text, amount, date, plus the account/category/tag briefing.
- Output per line: a cleaned short description (in your usual wording), a suggested category, and up to 3 tags — all restricted to existing IDs, blank when unsure.
- Suggestions are stored on the line, shown as small chips next to it, and carried into the "Create" link so `/add` opens prefilled with description, category and tags (in addition to today's amount/date/account).
- Runs in one batched request per statement (lines chunked), and re-runs with the "Re-analyze" button. If the AI call fails, the import still works exactly as today.

## Technical notes

- Migration: widen the `ai_endpoints.context_level` check constraint to include `xl`; add `suggested_description`, `suggested_category_id`, `suggested_tags` (text[]) to `statement_lines`.
- `src/lib/ai/contextBriefing.ts`: add `xl` to `AIContextLevel`, add caps + per-description examples; `src/lib/ai/types.ts` mirrors the type.
- `src/utils/aiContext.server.ts`: window days derived from level (30 / 30 / 180), transaction fetch limit raised for `xl`.
- `src/utils/ai.server.ts`: `EndpointRow.context_level` union, `list_transactions` returns tags and gets the reworded description.
- `src/lib/ai/systemPrompt.ts`: add the "search before guessing" rules.
- `src/utils/statements.server.ts`: new `classifyLines()` using the `statement_extract` connection (falling back to `chat`), plus wiring into analyse/re-analyse; `src/routes/statements.tsx` shows the chips and extends `addLink`.
- `src/routes/add.tsx` already reads `description`/`category`; add `tags` to its search params if missing.
- New i18n keys for the X-large option and the suggestion chips; help page note; bump `package.json` patch version.
