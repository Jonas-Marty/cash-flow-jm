# Smarter AI availability checks + "last checked" in Settings

## What's wrong today

The check calls `GET {base_url}/models` and treats any 200 as "online". It only falls back to a real
1-token chat ping when `/models` throws or errors. A LiteLLM proxy answers `/models` from its own
config, so it stays green even when the Ollama node behind Tailscale is down.

Checks also only run when you press "Check", and the result isn't timestamped.

## Options for a truer check (pick one as default per connection)

1. **Shallow (today)** — `GET /models` only. Fast, free, but proxies lie.
2. **Model listed** — `GET /models` and require the configured model id to actually appear in the
   list. Catches "model removed / not loaded" but a LiteLLM proxy still lists routes for a dead node.
3. **Real ping (recommended default)** — always send a 1-token `chat/completions` with the configured
   model, short timeout (~8s). This goes end-to-end through the proxy to Ollama, so a downed node
   fails. Costs a few tokens on commercial endpoints, which is why it's selectable per connection.
4. **Provider health endpoint** — LiteLLM exposes `/health` (and `/health/liveliness`). Try it first
   when present; it reports per-model upstream status. Requires an admin-capable key on many setups,
   so it's a best-effort extra, not the only signal.

Proposal: add a per-connection **"Availability check" selector** with `Fast (models list)`,
`Model listed`, `Real request (recommended)`. Default new and existing connections to
**Real request**, since that is the only one that detects your Tailscale/Ollama case. Where the
check is `Real request`, try LiteLLM `/health` first and fall back to the chat ping.

Also show *why* it's green: badge tooltip says which probe answered (`/models`, `/health`, `chat`)
plus latency; a degraded state (proxy reachable, model ping failed) renders **amber "Degraded"**
instead of red, with the upstream error text.

## Auto-check + "last checked"

- Settings runs a check automatically when the AI section becomes visible (once per mount, with a
  short client cache so navigating back and forth doesn't hammer the endpoints).
- Each badge gets a live relative timestamp: "checked 12s ago", updating every few seconds.
- A quiet auto-refresh every 5min while the Settings AI card is on screen; pauses when the tab is
  hidden.
- Manual "Check" button stays and forces an immediate re-check.
- Per-connection spinner while its own probe is in flight (checks run in parallel, as now).

## Fallback routing benefits

`resolveEndpoint` already pings before using a connection, but with the shallow probe it happily
selects the dead LiteLLM route and then the real request fails. Switching that pre-flight to the same
configured probe means chat/statement/voice actions fail over to the backup connection instead of
erroring.

## Technical details

- `src/lib/ai/types.ts`: add `health_mode: "fast" | "model_listed" | "real"` to `AIEndpoint`; extend
  `AIEndpointHealth` with `probe`, `checked_at`, `degraded`.
- Migration: `alter table ai_endpoints add column health_mode text not null default 'real'` with a
  check constraint; existing rows get `'real'`.
- `src/utils/ai.server.ts`: rework `pingEndpoint(baseUrl, token, model, mode)` — models-list parsing
  for `model_listed`, optional `GET /health` probe, chat ping for `real`; return `probe` and
  `degraded`. `resolveEndpoint` passes each row's `health_mode`.
- `src/utils/ai.functions.ts`: `checkAIEndpoints` returns the enriched health rows incl. server-side
  `checked_at`; `saveAIEndpoint` accepts `health_mode`.
- `src/components/AISettingsCard.tsx`: health-mode select per connection, auto-check on mount +
  60s interval with visibility guard, relative "checked Xs ago" label, amber degraded badge,
  per-row spinner.
- i18n keys (de/en) for the new labels, modes, degraded state and the timestamp string.
- Short paragraph in `/help` under the AI section explaining the three modes.
- Bump `package.json` version.
