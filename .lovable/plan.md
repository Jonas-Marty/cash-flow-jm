# AI Assistant — Plan

## Goals

1. **Add transactions from prose.** "I spent 100 at The Irish on beer, paid with credit card, Noah owes half." → user lands on `/add` with type, amount, account, description, category guess, and an IOU split pre-applied; user reviews & saves.
2. **Answer data questions.** "Where did I spend most last month?" → AI calls tools that mirror `/transactions` and `/insights` filters, then summarizes.
3. **Help & policy Q&A.** Explain app concepts, GDPR/privacy, and basic API usage. Refuse off-topic (relationships, code help, etc.) with a polite scoped reply.
4. **BYO provider only.** User configures an OpenAI-compatible base URL, API key, and model in Settings. No AI calls work until set.

## Scope (in)

- New Settings card "AI Assistant" with base URL / token / model fields.
- Floating chat bubble in `AppShell` + dedicated `/assistant` route with persistent history.
- Tool-calling backend (server function) that proxies to user's endpoint and exposes a fixed tool set.
- Deep link `/add?ai=<draftId>` (or session-state) that prefills the form including IOU split.
- System prompt with strict scope guard + refusal template.

## Out of scope

- Voice input, receipt OCR, streaming markdown rendering polish (basic streaming yes; rich animations no).
- Multi-step "agentic" automation that writes data without user confirmation (only `prepare_add_transaction` is a write-intent tool, and it still routes to `/add` for confirmation).
- Auto-categorization training; we rely on existing `suggestions` providers for category hints.

## UX

### Settings → "AI Assistant" card

- Enabled toggle
- Base URL (default placeholder `https://api.openai.com/v1`)
- API token (stored per-user in `settings` row, masked; "Test connection" button calls `/v1/models`)
- Model name (free text, e.g. `gpt-4o-mini`, `llama3.1:8b`)
- Help text linking to `/help#ai` and `/privacy` explaining the token is sent to the server and stored encrypted-at-rest only in the user's `settings` row (same as other secrets in this app — call out clearly).

### Chat surfaces

- **Floating bubble** (bottom-right in `AppShell`, hidden on `/add`, `/auth`, `/privacy`): opens a right-side `Sheet` with session-only messages. "Open full chat ↗" link to `/assistant`.
- `**/assistant` route**: full-page chat, conversation list in sidebar, persistent history in new `ai_conversations` + `ai_messages` tables.
- Empty state: 4 example prompts (one per capability: add tx, insight, help, privacy).
- Each assistant message that proposes an action renders an inline card:
  - `prepare_add_transaction` → "Open in Add form" button → navigates to `/add` with prefill state.
  - `query_*` → results summarized as markdown + optional small table.

### Add prefill

- `/add` already reads URL params (`type`, `amount`, `source`, `counterparty`, `reimburse_for`). Extend to also read `category`, `description`, `note`, `occurred_on`, `tags`, and IOU split (`split_with_name`, `split_amount`).
- IOU split prefill creates the form in "expense + add reimbursement" mode with the counterparty name pre-filled (counterparty matching to an existing account/contact happens client-side if a name match exists; otherwise free text).

## Tool surface (model-callable)

All tools are pure read-only except `prepare_add_transaction` which returns a draft (no write). All run as the authenticated user (RLS).


| Tool                      | Purpose                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list_transactions`       | Same filters as `/transactions`: date range, account ids, category ids, type, text search, tags, min/max amount, limit.            |
| `aggregate_spending`      | Group by category / account / tag / day / week / month over a date range; returns totals + top-N. Backs "where did I spend most…". |
| `get_insights_overview`   | Returns the same shape `/insights` Overview tab computes for a given period.                                                       |
| `list_accounts`           | All accounts with balances (for "how much is on my credit card").                                                                  |
| `list_categories`         | Categories with current-month budget vs actuals.                                                                                   |
| `list_open_ious`          | Open reimbursables (mirrors `OpenIOUsCard`).                                                                                       |
| `search_help`             | Returns matched sections from the static `help.tsx` content.                                                                       |
| `prepare_add_transaction` | Validates a draft against accounts/categories and returns a normalized prefill object (+ optional IOU split). Does NOT write.      |


The tool layer reuses functions already in `src/lib/finance.ts` and `src/lib/insights.ts` — no SQL duplication.

## Topic guard

System prompt pins the assistant to:

- Personal finance entries and analysis in this app.
- Explaining app features and the privacy policy.
- Basic API usage (token creation, `/api/public/*` endpoints).

Anything else → single-sentence refusal + a suggestion of an in-scope action. Implemented in the system prompt; no extra classifier needed.

## Technical details

### Data model (new tables, migration)

- `ai_settings` columns added to existing `settings` table (or new `ai_settings` table keyed by `user_id`): `ai_enabled boolean`, `ai_base_url text`, `ai_api_token text` (server-only column; never selected client-side — server fn reads via service role), `ai_model text`.
- `ai_conversations(id, user_id, title, created_at, updated_at)`
- `ai_messages(id, conversation_id, user_id, role, content jsonb, tool_calls jsonb, created_at)` — `content` is jsonb to store text + tool result cards.
- RLS: user can CRUD their own rows. GRANTs to `authenticated` + `service_role`.

### Server functions (TanStack `createServerFn`, all auth-protected)

- `aiChat({ conversationId, userMessage })` — appends message, loads history, fetches token+url+model from the user's settings via `supabaseAdmin` (token never leaves server), calls `${base_url}/chat/completions` with the tool schemas, executes any tool calls server-side (via existing `finance.ts` helpers using the user-scoped `supabase` client from `requireSupabaseAuth`), loops until model returns final text, persists assistant message, returns it. Streaming via `text/event-stream`; falls back to non-streaming if endpoint doesn't support it.
- `aiTestConnection({ baseUrl, token, model })` — calls `/models` or a tiny `/chat/completions` ping.
- `aiListConversations`, `aiGetConversation`, `aiDeleteConversation`, `aiRenameConversation`.

### Tool execution

- Tools are TS functions in `src/lib/ai/tools.ts` with Zod input schemas. Each receives the auth-scoped `supabase` client + `userId` and returns serializable data. Schema kept small to avoid Gemini-style constrained-decoding limits (no long enums; category/account names are looked up by name with fuzzy match inside the tool).

### System prompt (single source in `src/lib/ai/systemPrompt.ts`)

Includes: app overview, current date, user's currency from `settings`, list of available tools, scope rules, refusal template, "always confirm before suggesting a write" rule, "never reveal the API token or other users' data" rule.

### Add prefill plumbing

- Extend `AddPrefill` in `src/routes/add.tsx` with the new fields and IOU split fields.
- Add `applyPrefill` effect that, after accounts/categories load, resolves the prefilled `account` / `category` names to IDs and toggles the "Add reimbursement" sub-form with the split amount.
- The chat's "Open in Add form" button uses `navigate({ to: "/add", search: { ...prefill } })`.

### i18n

All new strings under `ai.*` (EN+DE) in `src/i18n/index.tsx`.

### Help & Privacy updates

- New `/help#ai` section: how to configure, supported endpoints (OpenAI, Ollama, LM Studio, OpenRouter), what data is sent, scope rules.
- `/privacy`: add paragraph that when AI is enabled, message contents + relevant transaction data are sent to the user-configured endpoint; the server forwards but does not log payloads beyond standard error logging.

## Files

**New**

- `src/routes/assistant.tsx` (full chat page)
- `src/components/AssistantBubble.tsx` (floating bubble + Sheet)
- `src/components/AssistantChat.tsx` (shared chat surface used by both)
- `src/components/AISettingsCard.tsx`
- `src/lib/ai/systemPrompt.ts`
- `src/lib/ai/tools.ts` (tool definitions + executors)
- `src/lib/ai/openaiClient.ts` (thin fetch wrapper for OpenAI-compatible APIs + tool-call loop)
- `src/utils/ai.functions.ts` (server functions above)
- `src/utils/ai.server.ts` (server-only helpers: load settings via admin client, run tool loop)
- Migration for `ai_conversations`, `ai_messages`, and `settings` columns.

**Edited**

- `src/routes/add.tsx` — extend `AddPrefill`, resolve prefilled names, IOU split prefill.
- `src/components/AppShell.tsx` — mount `AssistantBubble`, add `/assistant` nav entry.
- `src/routes/settings.tsx` — render `AISettingsCard`.
- `src/routes/help.tsx` — new "AI Assistant" section.
- `src/routes/privacy.tsx` — AI data-flow paragraph.
- `src/i18n/index.tsx` — `ai.*` keys.
- `src/routeTree.gen.ts` — auto-regen.

## Open question (won't block plan)

The token is stored server-side and only ever read by server functions; the server-side `settings` row column is excluded from any client `select`. Confirm this matches your threat model, or we should add a "session-only" mode where the token lives in `sessionStorage` and is sent per request (more private, breaks across reloads). --> yes store server side, add entry to /privacy that this token is stored there and potentially readable by the server operator.