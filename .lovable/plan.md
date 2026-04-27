# Plan: Link Nextcloud documents to transactions

## Goals

1. Each transaction can have multiple attachments (generic, source-agnostic).
2. From the transaction edit/add UI, search Nextcloud by filename and pick a file.
3. Authenticate to Nextcloud via OAuth2 (per user), with the least-privileged token possible.
4. Expose an authenticated REST API so an external service can attach a link to a transaction using a per-user API token.

---

## 1. Database

### Table `transaction_attachments`

```text
id              uuid PK
transaction_id  uuid  -> transactions.id (cascade)
user_id         uuid  default auth.uid()  (for RLS)
source          text  ('nextcloud' | 'manual' | future sources)
display_name    text
link_url        text  (URL the user clicks to open the file)
added_at        timestamptz default now()
```

- RLS: `user_id = auth.uid()` for all ops.
- Index on `transaction_id`.
- No `nextcloud_path` stored — keeps schema source-agnostic.

### Table `nextcloud_connections` (per user)

```text
user_id           uuid PK -> auth.users
base_url          text   (e.g. https://cloud.example.com)
access_token      text   (encrypted column via pgsodium or stored as-is in private schema)
refresh_token    text
token_expires_at  timestamptz
scope             text
created_at, updated_at
```

RLS: own row only. Service role bypasses for token refresh in server functions.

### Table `api_tokens` (per user, for external service)

```text
id           uuid PK
user_id      uuid -> auth.users
name         text   (e.g. "nextcloud-bridge")
token_hash   text   (sha256 of the token; raw token shown once on creation)
last_used_at timestamptz
created_at   timestamptz
revoked_at   timestamptz nullable
```

RLS: own rows only.

---

## 2. Nextcloud OAuth2 setup

User-side one-time setup:

- In Nextcloud admin → Security → OAuth 2.0 clients, register a client.
- Redirect URI: `https://<app>/api/nextcloud/callback`.
- Note: Nextcloud's OAuth2 currently issues tokens that grant the same access as the user (it does not support fine-grained scopes today). To still **minimize privilege**, the plan adds these mitigations:
  1. Recommend the user create a **dedicated Nextcloud user** (e.g. `lovable-finance-readonly`) and share only the relevant folder(s) read-only with that user, then OAuth as that account.
  2. Server only ever issues `PROPFIND` / `SEARCH` (read) requests — never `PUT`/`DELETE`.
  3. Document this clearly in the Settings UI.

App-side:

- Settings page section "Nextcloud": user enters `base_url`, `client_id`, `client_secret`. Stored in `nextcloud_connections` (client_secret as a secret per user — kept in the row, server-only access).
- "Connect" button → redirects to `{base_url}/apps/oauth2/authorize?...`.
- Callback route `/api/nextcloud/callback` exchanges code → tokens, stores in `nextcloud_connections`.
- Helper `getValidNextcloudToken(userId)` server function refreshes if expired.

---

## 3. File search (server function)

`searchNextcloudFiles({ query })`:

- Auth-required server function (uses `requireSupabaseAuth`).
- Loads connection + valid token.
- Calls Nextcloud WebDAV SEARCH (or the simpler `ocs/v2.php/search/providers/files/search?term=...`) — returns file name, path, mime, size, and a shareable URL.
- Generates a link to use as `link_url`. Two options, pick at implementation time:
  - **Direct WebDAV URL** `{base_url}/remote.php/dav/files/{user}/{path}` — opens in browser, requires user to be logged into Nextcloud. Simple and respects ACLs.
  - **Public share link** via OCS Share API — more clickable but creates a public link (not what the user wants for non-public docs).
  - → Plan picks **direct WebDAV URL** (private, requires Nextcloud login).
- Returns `[{ name, path, link_url, mime, size }]` (max ~25 results).

---

## 4. UI

### Edit/Add transaction page

- New section "Attachments" (shown in edit and add mode).
- List existing attachments with display_name + open icon + remove button.
- "Attach file" button → opens dialog:
  - Search input (debounced) → calls `searchNextcloudFiles`.
  - Result list with filename + folder breadcrumb. Click to attach.
  - Empty state with link to Settings if Nextcloud not connected.

### Transactions list page

- Show a small paperclip icon on rows that have attachments (count badge).

### Settings page

- New "Nextcloud" card: connect/disconnect, show connected account, base URL.
- New "API tokens" card: list tokens, "Generate token" (shows raw token once + copy button), revoke.

---

## 5. Public REST API for external service

Server route: `app/routes/api/public/attachments.ts` (POST).

- Auth: `Authorization: Bearer <api_token>` header.
- Validates token by hashing and looking up active row in `api_tokens`; loads `user_id`.
- Body (Zod):
  ```text
  { transaction_id: uuid, link_url: url, display_name: string(1..255), source?: string(default "nextcloud") }
  ```
- Verifies the transaction belongs to the same `user_id` (using `supabaseAdmin`).
- Inserts into `transaction_attachments`. Updates `last_used_at`.
- Returns `{ id, transaction_id, link_url }`.
- Rate limit: simple in-memory per-token bucket (best effort).

Companion endpoint (required, useful for the external service):

- `GET /api/public/transactions?from=&to=&q=` — search transactions to get IDs. Same auth.

---

## 6. Files to add / change

**New**

- `supabase/migrations/<ts>_attachments_and_nextcloud.sql` — tables + RLS + indexes.
- `src/routes/api/nextcloud/callback.ts` — OAuth2 callback.
- `src/routes/api/public/attachments.ts` — POST endpoint.
- `src/utils/nextcloud.functions.ts` — `connectNextcloud`, `searchNextcloudFiles`, `disconnectNextcloud`, token refresh.
- `src/utils/api-tokens.functions.ts` — create/list/revoke.
- `src/utils/api-tokens.server.ts` — hash + verify helpers.
- `src/components/AttachmentsSection.tsx` — list + add UI used inside `TransactionForm`.
- `src/components/NextcloudFilePicker.tsx` — search dialog.

**Edited**

- `src/routes/add.tsx` — render `<AttachmentsSection editId={...} />` when editing (and after first save in add mode).
- `src/routes/transactions.tsx` — paperclip indicator + count.
- `src/routes/settings.tsx` — Nextcloud + API tokens cards.
- `src/lib/finance.ts` — types + fetch helpers for attachments.
- `src/i18n/index.tsx` — new strings (EN + DE).
- [architecture.md](http://architecture.md) - describe the new api endpoints, oauth workflow, different token, how they are hashed, short guid how to get clientid etc. from nextcloud, how does search work for nextcloud

---

## 7. Security notes

- API tokens stored only as sha256 hash; raw token shown once on creation.
- All Nextcloud calls happen server-side; access tokens never leave the server.
- The dedicated Nextcloud user pattern is the recommended way to enforce read-only / folder-scoped access since Nextcloud OAuth2 lacks granular scopes.
- Public API endpoints validate that the target `transaction_id` belongs to the token's user before inserting.

---

## 8. Out of scope (call out so we agree)

- No file upload to Nextcloud, only linking.
- No preview/thumbnail rendering of Nextcloud files in the app.
- No automatic OCR / matching of files to transactions (that's the external service's job).
- No webhook from Nextcloud back into the app.