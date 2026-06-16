## Outbound Webhooks for Transactions

Let you register webhook endpoints (e.g. an n8n workflow) that get called whenever a transaction lands in your app, so a downstream service can forward shared expenses to Flatastic.

### Events that fire a webhook
- `transaction.created.manual` — added via the Add screen
- `transaction.created.recurring` — auto-posted by a recurring rule
- `transaction.created.api` — added via `/api/public/transactions`

(Edits/deletes are out of scope per your choice.)

### What gets sent
`POST <your URL>` with JSON:
```json
{
  "event": "transaction.created.manual",
  "delivered_at": "2026-06-16T10:00:00Z",
  "delivery_id": "uuid",
  "transaction": { /* full row: id, occurred_on, amount, type,
    source_account_id, destination_account_id, category_id,
    description, note, tags: [...], created_at */ }
}
```
Tags are joined in so n8n can branch on `#shared`, `#coop` etc. without a second call.

### Managing webhooks (Settings page)
New "Webhooks" card next to API Tokens, with:
- Name
- Target URL
- Auth mode: **Header auth** — custom header name + value, sent verbatim (works directly with n8n's Header Auth credential; simplest of the three n8n options, no JWT minting, no base64 dance)
- Active toggle
- "Send test event" button
- Recent deliveries list (last 20) with status code + timestamp + error

### Delivery behavior
- Fired from inside the same server-side path that creates the transaction (manual add server fn, recurring processor, public API route) — **after** the DB insert commits.
- **Retry loop, no queue:** up to 3 attempts in-process with 1s / 4s backoff, 10s timeout per attempt. Total worst-case ~15s; happens after the response is already returned to the client via `ctx.waitUntil`-style fire-and-forget (`void deliver(...)`).
- Every attempt logs:
  - `console.log` JSON line (`event: "webhook.delivery"`, status, attempt, durationMs, webhookId) so it shows in worker logs / stdout
  - Row in `audit_logs` (`action: 'webhook.delivery'`, entity `webhook`, with status + attempts + last error)
- Failures after the final attempt are logged but don't block the transaction.

### Future notification integrations (Gotify etc.)
Webhook dispatch is wrapped in a small `notifiers/` module with a `Notifier` interface (`name`, `deliver(event)`). The HTTP webhook is the first notifier; adding Gotify later = drop a new file implementing the same interface and register it. The trigger sites stay unchanged.

### Technical details

**Schema** (new migration):
```sql
create table public.webhooks (
  id uuid pk, user_id uuid → auth.users,
  name text, url text,
  auth_header_name text, auth_header_value text, -- nullable
  events text[] not null default array['transaction.created.manual',
                                       'transaction.created.recurring',
                                       'transaction.created.api'],
  active boolean default true,
  created_at, updated_at
);
-- GRANTs to authenticated + service_role, RLS scoped to auth.uid()
```
No separate deliveries table — `audit_logs` already exists and you wanted it used.

**Files**
- `supabase/migrations/<ts>_webhooks.sql`
- `src/lib/notifiers/types.ts` — `Notifier` + `WebhookEvent` types
- `src/lib/notifiers/webhook.server.ts` — fetches active webhooks for user, attempts HTTP delivery with retry, writes audit log, console logs
- `src/lib/notifiers/dispatch.server.ts` — `dispatchTransactionCreated(userId, source, txId)`: loads full tx + tags via supabaseAdmin, calls each registered notifier; swallows errors
- `src/utils/webhooks.functions.ts` — list / create / update / delete / test (mirrors `api-tokens.functions.ts`)
- `src/components/WebhooksCard.tsx` — settings UI
- `src/routes/settings.tsx` — mount the card
- Trigger points (one-line `void dispatchTransactionCreated(...)` after each insert):
  - `src/routes/add.tsx` server insert path (or its server fn)
  - `src/routes/api.public.process-recurring.ts`
  - `src/routes/api.public.transactions.ts`
- `src/i18n/index.tsx` — `webhooks.*` keys (EN + DE)

**Security**
- RLS scoped per user; service role used only inside notifier to read transaction + tags.
- `auth_header_value` stored plain in DB (same trust level as the rest of the user's account data); never logged to stdout or audit_logs — only header *name* is logged.
- URL is constrained to `https://` (allow `http://` only for localhost during dev) to avoid accidental cleartext.

**Out of scope**
- Edit/delete events, per-webhook event filtering UI, per-tag/account filters (you can branch in n8n).
- Background queue / persistent retry beyond the 3-attempt loop.
- Signature verification (skipped — n8n doesn't support HMAC natively, header auth is the simpler equivalent).