# Encrypting all financial data at rest with a user-held key — analysis & design record

Status: **postponed** (decided 2026-09-13). This document captures everything gathered so the
work can be picked up later without redoing the exploration. Nothing has been implemented.

Origin: analysis session of 2026-09-12/13 (see the pointer in
`architecture.md` §6). When resumed, add a new §3.12 to `architecture.md`.

---

## 0. Decisions already taken (2026-09-12)

| Question | Decision | Consequence |
|---|---|---|
| Threat model | **At rest + backups.** DB dumps, Garage backups, Studio, disk, other containers see only ciphertext. A live request carries the key; Postgres decrypts in-session. | Keeps all SQL aggregates, the recurring engine, tags, AI, statement import. Does *not* defend against a malicious live operator (who could also serve altered JS). |
| Key source | **Device key + recovery code.** Random 256-bit DEK stored on the device; only copy in DB is wrapped under a long random recovery code. New device = transfer code/QR from an unlocked device, or the recovery code. | Nothing to type day-to-day. No brute-forceable passphrase. Lost device + lost code = data gone. Independent of password resets. |
| Headless processing | **App-open is fine.** Cron endpoint skips encrypted users; `process_recurring_rules_if_stale` on dashboard load does the work with the key. | Auto-posts and their webhooks land on next app open. Phone-ingested pending rows arrive any time (encrypted to a public key) and get suggestions on next open. |

Options rejected:
- **Strict client-side E2EE** — rewrite ~10 SQL aggregates, the recurring engine, split-save,
  reimbursement maths and the AI tool loop in the browser; weeks of work, permanent tax on every
  feature; illusory against an operator who serves the JS.
- **Text-only encryption (keep amounts plaintext)** — cheap, but amounts are the point.

---

## 1. Facts about the current system (exploration results)

### 1.1 Stack and deployment
- TanStack Start v1 / React 19 / Vite 7; Node SSR container (`server/node-server.mjs`) behind
  nginx or Dokploy/Traefik; alternatively Cloudflare Workers (`wrangler.jsonc`, `nodejs_compat`).
- Self-hosted Supabase on a private homelab host via Dokploy (`docs/supabase-stack-trim.md`,
  `docker-compose.prod-supabase.yml`, `docker-compose.dev-supabase.yml`):
  `supabase/postgres:15.8.1.060`, `postgrest/postgrest:v12.2.11` (`PGRST_DB_USE_LEGACY_GUCS=false`,
  `PGRST_DB_SCHEMAS=public,storage,graphql_public`), `kong:2.8.1`, `gotrue:v2.171.0`,
  `storage-api:v1.22.7`. Backups: `pg_dump` as `supabase_admin` to Garage S3 bucket `dokploy-backup`.
- Kong `rest-v1` route plugins: `cors` (default config → reflects `Access-Control-Request-Headers`,
  so a custom `x-data-key` header passes preflight), `key-auth`, `acl`. Nothing strips unknown headers.
- DB started with `-c config_file=… -c log_min_messages=fatal`; `log_statement` /
  `log_parameter_max_length` are image defaults (must be pinned, see §6).
- Migrations: `supabase/migrations/*.sql` (89 files, `20260420142523…` → `20260906150000_pending_suggest_note_place.sql`)
  are the sole source of truth. `docker/migrate/run-migrations.sh` applies them in filename order,
  one `psql -f` per file, **no `--single-transaction`**, tracking `public.schema_migrations`.
  `docker/db/99-app-migrations.sh` is the first-boot variant (runs as `postgres`, not superuser).
  Dev helpers: `scripts/dev/{clone-prod-db.sh,reset-dev-db.sh,scrub-dev.sql,lib.sh,tools.sh}`.
  `scrub-dev.sql` blanks Nextcloud secrets and deactivates webhooks only — financial data is cloned as-is.
- `src/integrations/supabase/types.ts` is hand-maintained (no `gen types` script anywhere). It
  emits `Insert`/`Update` for views (`account_balances` with `balance?: never`). Only
  `src/lib/links.ts:4-6` indexes `Database["public"]["Tables"]` directly.

### 1.2 Authentication and sessions
- Sign-in: email + password (`supabase.auth.signInWithPassword`, `src/components/AuthPage.tsx:40`)
  and OAuth via rows in `auth_providers` (`google`, `microsoft→azure`, `keycloak`; mapping in
  `src/lib/authProviders.ts`). Sign-up `signUp` with GDPR checkbox. **No** magic link, OTP, MFA,
  passkeys, password reset or password change anywhere (`LinkedAccountsCard.tsx` only links identities).
- `handle_new_user()` (`20260424105632…sql:77-111`, SECURITY DEFINER, `AFTER INSERT ON auth.users`)
  grants roles, back-fills orphan rows, inserts default `settings`. Natural hook for provisioning.
- Sessions in `localStorage` only (`client.ts` → `brokeredPreviewStorage()`), no cookies.
  `src/start.ts` decodes the `Authorization` header (unverified) for log labels only.
- Server functions: `auth-attacher.ts` (client middleware) attaches `Authorization: Bearer`;
  `auth-middleware.ts` (`requireSupabaseAuth`) builds a request-scoped user-JWT client and exposes
  `{ supabase, userId, claims }`. Service-role client: `client.server.ts` (`supabaseAdmin`).
- **No SSR data fetching** — zero `loader`/`beforeLoad` in `src/routes/*.tsx`; all data via
  TanStack Query in the browser after hydration. `src/routes/__root.tsx`: `QueryClientProvider →
  AuthProvider → AuthGate → I18nGate → Outlet`; `AuthGate` (lines 72-100) is the single gate.
- `src/lib/auth.tsx` distinguishes fresh interactive `SIGNED_IN` from session restore
  (`sessionStorage` `just-signed-in:<uid>`), logs auth events via `log_audit_event`.
- No PWA, service worker, IndexedDB, offline mode, query persistence, export/backup feature.
  Web-storage keys: `cashflow.dashboard.privacy-hidden`, `pending.view`, `link-prompt-never:<uid>`,
  `link-prompt-dismissed:<uid>`, `just-signed-in:<uid>`, Supabase `sb-*-auth-token`.

### 1.3 Existing crypto and secrets
- **No encryption anywhere**: no pgcrypto/pgsodium/vault, no `CREATE EXTENSION` in migrations,
  no WebCrypto, no crypto dependencies in `package.json`.
- Hashing/signing only: `src/utils/api-tokens.server.ts` (`cfjm_` + 32 random bytes, unsalted
  SHA-256 stored in `api_tokens.token_hash`), using `node:crypto`. The Nextcloud OAuth state is
  a random nonce stored on `nextcloud_connections.oauth_state` (since `20260924120000…`), not a
  signature, so no signing secret exists.
- Plaintext secret columns: `nextcloud_connections.client_secret/access_token/refresh_token`
  (table revoked from `anon`/`authenticated` since `20260924120000…`; server-only),
  `ai_credentials.api_token` (dead table), `ai_endpoints.api_token` (the column-level grants of
  `20260815170838…` never took effect because Supabase's default table-wide grant covered every
  column; since `20260924140000…` the table is revoked from `anon`/`authenticated` and server-only),
  `webhooks.auth_header_value` (still readable by the owner's browser: webhooks are managed through
  the user's own client, so it needs column grants rather than a table revoke,
  and it is not in the audit redaction allowlist either), `auth_providers.client_id`.
- Privacy copy that must change with this feature: `src/routes/privacy.tsx:35` (banner), `:60`/`:126`
  (§6 EN/DE), `:69-70`/`:135` (§6a AI), `src/routes/help.tsx:262-263` (+ DE ≈ `:600`) "Is my data
  encrypted? → No", and the help string inside `src/utils/ai.server.ts`.

### 1.4 Tables and sensitive columns (🔴 = must be encrypted, ⚠️ = server logic depends on it, 🔐 = secret)

| Table (defining migration) | Sensitive columns | Stays plaintext (ids/dates/enums/FKs/status) |
|---|---|---|
| `transactions` (`20260420142523…` + 8) | `amount` 🔴⚠️ (`CHECK > 0`), `destination_amount` 🔴⚠️, `fee_amount` 🔴⚠️, `description` 🔴, `note` 🔴⚠️ (tag regex), `reimbursable_counterparty/_reason/_cancel_reason` 🔴, `latitude/longitude/location_accuracy_m/location_label` 🔴 | `id, user_id, occurred_on, type, source/destination_account_id, category_id, fee_transaction_id, fee_category_id, is_reimbursable, reimbursable_status, reimbursable_writeoff_*`, `location_source, recurring_rule_id, split_group_id` |
| `accounts` | `name` 🔴⚠️, `opening_balance` 🔴⚠️ | `type, currency_code/_symbol, archived, icon, emoji, image_url, color, pinned, pin_order` |
| `categories` | `name` 🔴⚠️ (ordered by in SQL; `.eq("name", RECONCILE_CATEGORY_NAME)` lookups), `allocated_budget` 🔴⚠️ | `group_id, rolls_over, sweep_target_category_id, is_scope, funding_category_id, closed_at, sort_order, archived, visuals` |
| `category_groups` | `name` 🔴⚠️ | `kind, sort_order, archived, sweep_target_category_id` |
| `category_budgets` (no `user_id`; owned via categories) | `amount` 🔴⚠️ | PK `(category_id, month)` |
| `category_reallocations` | `amount` 🔴⚠️, `note` 🔴 | `from/to_category_id, occurred_on` |
| `recurring_rules` (`20260707213840…`) | `name`, `amount` 🔴⚠️, `estimated_amount` 🔴⚠️, `description`/`note` 🔴⚠️ (templates for `interpolate_template`) | schedule columns, `auto_post, archived, is_variable_amount, is_split, …` |
| `recurring_rule_slices` (no `user_id`; via rule) | `amount` 🔴⚠️, `description`, `note`, `reimbursable_counterparty/_reason` 🔴 | `amount_ratio, category_id, is_reimbursable, sort_order` |
| `recurring_occurrences` | — | all (joined to rule amounts in `account_balances_as_of`) |
| `pending_transactions` (`20260505070107…` + 4) | `amount` 🔴 (`CHECK > 0`), `destination_amount`, `description`, `note`, `external_info` 🔴 (raw notification text), `location_*` 🔴, `suggested_description/_note/_tags/_location` 🔴, `reject_reason` 🔴 | `status, accounts, category_id, occurred_on, external_source, external_ref` (unique dedupe index `pending_transactions_external_dedupe`), `suggested_category_id, suggestion_source/_confidence, suggested_at, confirmed_*` |
| `transaction_tags` | `tag` 🔴 (PK `(transaction_id, tag)`, derived server-side from `note`) | `transaction_id` |
| `transaction_links` / `_members` | `title`, `note` 🔴 | `kind, planned_on`; members all plain |
| `transaction_reimbursements` | `amount` 🔴⚠️ | ids, `UNIQUE(original, settling)` |
| `account_statements` | `statement_balance` 🔴, `note`, `external_ref` 🔴 | `account_id, as_of, source, status, compensation_transaction_id`; `UNIQUE(account_id, as_of, source)` |
| `statement_imports` | `file_name`, `closing_balance`, `storage_path`, `external_url` 🔴 | `account_id, period_*, currency_code, status, model, match_window_days, file_source, file_type` |
| `statement_import_lines` | `description`, `amount`, `raw_text` 🔴 (verbatim bank line), `match_score` | `import_id, line_no, dates, match_status, matched_transaction_id, decision` |
| `transaction_attachments` | `display_name`, `link_url` 🔴 | parents, `source`, `added_at` |
| `ai_conversations` / `ai_messages` | `title`; `content jsonb`, `tool_calls jsonb` 🔴 | `role`, ids |
| `ai_audit_logs` | `payload jsonb` 🔴 (previews of user messages, tool args, up to 2000 chars of tool results), `error_message` | `kind, model, provider_host, tool_name, tokens, ok, duration_ms` |
| `audit_logs` (`20260430043050…`, trigger `20260529062508…`) | `diff jsonb` 🔴 — full row on insert/delete, `{col:{old,new}}` on update for 14 tables; redaction allowlist covers only Nextcloud secrets, `token_hash`, `client_id` | `action, table_name, row_id, metadata` |
| `settings` | `day_heatmap_threshold` 🔴 | everything else (currency, language, theme, sweep/scope ids, `last_recurring_sweep_on`, `capture_location`) |
| `nextcloud_connections`, `ai_endpoints`, `ai_credentials`, `webhooks` | secrets 🔐 (see §1.3) | — |
| `api_tokens`, `user_roles`, `auth_providers`, `ai_action_endpoints` | none | — |

Constraints/indexes touching sensitive columns: `transactions.amount NOT NULL CHECK (amount > 0)`,
`pending_transactions.amount CHECK (> 0)`, `(latitude IS NULL) = (longitude IS NULL)` on both,
`transaction_tags` PK on plaintext `tag` + `idx_transaction_tags_tag`, `transactions_location_idx`.
No full-text/trigram indexes, no `ILIKE` in migrations.

### 1.5 SQL objects that read or compute over sensitive columns

| Object | Latest definition | Depends on | Does |
|---|---|---|---|
| VIEW `account_balances` | `20260428054216…` | `accounts.opening_balance`, `transactions.amount/destination_amount/type/occurred_on` | `opening + Σ(±amount)` per account; no `user_id` filter in the view |
| `account_balances_as_of(date)` | same | above + `recurring_rules.amount/estimated_amount/is_variable_amount`, `recurring_occurrences` | balances incl. projected pending recurring amounts; `SECURITY DEFINER` |
| `category_month_spending(date)` | `20260428083206…` | `categories.allocated_budget/name`, `category_groups.kind/name`, `category_budgets.amount`, `transactions.amount/type/category_id` | allocated / spent_or_received / variance, effective kind; **orders by name** |
| `category_savings_balance_v2(date)` (+ old VIEW `category_savings_balance`, still used by `finance.ts` and `ai.server.ts`) | `20260429114020…`, `20260429114112…` | transactions, reallocations, budgets, sweep targets, `settings.default_sweep_category_id` | cumulative savings balance incl. computed sweeps — heaviest function |
| `category_savings_balance_series(date,date)` | `20260728161329…` | lateral `_v2` per month | 12+ full recomputations |
| `reconciliation_summary(date)` | `20260823111811…` | balances + `_v2` + budgets | drift = accounts − savings − unswept |
| `archive_savings_envelope(uuid,uuid)` | same | `_v2.cumulative_balance` | inserts a reallocation with that amount |
| `ensure_month_budgets(date)` | `20260427152445…` | `category_budgets.amount`, `categories.allocated_budget` | copies amounts forward; `SECURITY DEFINER` |
| `process_recurring_rules(date)`, `process_recurring_rules_for_all_users(date)`, `apply_recurring_rule_backfill(uuid,text,date)`, `interpolate_template(...)`, `format_date_token(...)`, `validate_recurring_rule()` | `20260707213840…` (713 lines) | rule amount/description/note, slices amount/ratio, `settings.format_locale` | materialise transactions/pending rows from templates (regex substitution on plaintext); split rounding; backfill uses `ON CONFLICT (user_id, external_source, external_ref) DO NOTHING` twice |
| `process_recurring_rules_if_stale(date)` | `20260815165403…` | `settings.last_recurring_sweep_on` | browser-driven sweep wrapper (SECURITY INVOKER) |
| `save_split_group(...)`, `validate_transaction_split_group()` (deferred constraint trigger) | `20260904200000…` | slice `amount > 0`, ownership; `SET CONSTRAINTS public.trg_validate_transaction_split_group IMMEDIATE` | atomic split save via `UPDATE/INSERT … RETURNING id INTO` |
| `sync_transaction_tags()` trigger `trg_tx_tags` | `20260622112110…` | `transactions.note` | `regexp_matches(note, '#([[:alnum:]_][[:alnum:]_-]*)', 'g')` → `transaction_tags` |
| `recompute_reimbursable_status`, `validate_reimbursement_link`, `after_reimbursement_link_change`, `cascade_delete_reimbursement_links`, `tx_amount_change_recompute_reimb`, `default_reimbursable_status` | `20260502150924…`, `20260518091335…` | amounts | Σ linked vs amount (tolerance 0.0049), null reimbursable text when not reimbursable |
| `validate_transaction_destination_amount`, `clear_non_transfer_fee_fields`, `cascade_delete_transfer_fee` | `20260428054033…`, `20260518100550…` | `destination_amount`, `accounts.currency_code`, fee fields | transfer/currency/fee rules |
| `validate_category_reallocation`, `validate_*_sweep_target`, `block_sweep_target_delete`, `validate_active_scope`, `clear_closed_active_scope`, `cleanup_budgets_on_savings_flip` | `20260429114020…`, `20260613085703…`, `20260428083206…` | `amount > 0`, ids | validation |
| `reopen_statement_on_comp_delete`, `validate_pending_transaction_refs`, `reset_occurrence_on_tx_delete` | `20260518105738…`, `20260505070107…`, `20260424074531…` | ids/status | plaintext not needed |
| `audit_row_change()` (SECURITY DEFINER, 14 tables), `log_audit_event`, `prune_audit_logs` | `20260529062508…`, `20260430043050…` | `to_jsonb(NEW/OLD)` | full-row / per-column plaintext into `audit_logs.diff` |
| Metrics (`api.public.metrics.ts`) | — | `count(*)` only | not a blocker |

No `%ROWTYPE`, `RETURNS SETOF <table>` or `RETURNS public.<table>` exist (only `RETURNS TABLE`).

### 1.6 Application data paths

Browser (anon key + RLS, `src/lib/finance.ts` 1698 lines + components/routes): tables listed above;
RPCs `account_balances_as_of, ensure_month_budgets, category_month_spending, process_recurring_rules(_if_stale),
preview_recurring_rule, archive_recurring_rule, apply_recurring_rule_backfill, category_savings_balance_v2,
category_savings_balance_series, reconciliation_summary, archive_savings_envelope, save_split_group`.
Call sites per table: `transactions` 52, `categories` 27, `settings` 18, `api_tokens` 16,
`account_statements` 16, `accounts` 14, `recurring_occurrences` 13, `pending_transactions` 13, …

PostgREST embedding in use (8 sites): `recurring_occurrences → recurring_rules!inner(...)`
(`finance.ts:576`, `api.public.process-recurring.ts:59`), `recurring_rules → slices:recurring_rule_slices(*)`
(`finance.ts:708-763`), `statement_import_lines → statement_imports!inner(...)`
(`statements.detail.server.ts:343`, `transactions.tsx:177`).

Upserts (cannot target trigger-backed views): `finance.ts:643`, `settings.tsx:191` (`category_budgets`
on `category_id,month`), `finance.ts:1322`, `api.public.account-statements.ts:150` (`account_statements`
on `account_id,as_of,source`); `links.ts` upserts hit `transaction_link_members` (stays a table).

Server paths needing plaintext:
- Public API (service role, `cfjm_` token): `api.public.transactions.ts` (POST inserts full rows,
  fires webhooks), `api.public.pending-transactions.ts` (GET/POST/DELETE; POST runs
  `labelFromHistory` over 200 recent transactions and async `enrichPending`), `api.public.account-statements.ts`
  (compensating transactions; `.eq("name", RECONCILE_CATEGORY_NAME)`), `api.public.attachments.ts`,
  `api.public.process-recurring.ts` (cron, `METRICS_TOKEN`), `api.public.metrics.ts`, `api.public.prune-audit.ts`.
- `src/utils/pending.enrich.server.ts` (service role; 60 pending rows + 1500 transactions + categories/accounts/tags
  → `suggestFromHistory` then LLM), `ai.server.ts` (chat, 6 tools incl. `description.ilike/note.ilike` at `:552`,
  `aggregate_spending` ≤ 5000 rows; `writeAudit` via `supabaseAdmin` at `:71`), `aiContext.server.ts`
  (briefing 400/1200 rows, user-JWT client), `statements.server.ts` / `statements.detail.server.ts`
  (PDF text via `unpdf`, CSV, vision model, `descSimilarity` matching, raw file bytes to bucket
  `statement_files` at `${userId}/${uuid}.ext`, 300 s signed URL), `statements.classify.server.ts`,
  `nextcloud.server.ts`, `src/lib/notifiers/dispatch.server.ts` + `webhook.server.ts` (POST full
  transaction row + tags to user webhooks).
- Already pure client-side (E2EE-compatible): `src/lib/insights.ts` and all insights tabs,
  transactions page search/filter (`amountFilter.ts`), `usageScoring.ts`, `src/lib/suggestions/*`,
  `DescriptionAutocomplete.tsx`, `reimbMatch.ts`, `recurringSlices.ts`, `recurrence.ts`, `fx.ts`
  (Frankfurter API, currency codes only), `budgetSummary.ts`, `pendingSuggest.ts` (pure, but only
  consumer is the server).
- Filters that would hit encrypted columns: `.order("name")` on accounts/categories (8 sites),
  `useRecentLocations.ts:24 .not("latitude","is",null)`, `finance.ts:1126 .not("reimbursable_counterparty","is",null)`,
  `ai.server.ts:552` ilike, the two `RECONCILE_CATEGORY_NAME` lookups, `labelFromHistory`.

Settings page structure (`src/routes/settings.tsx`, 1119 lines): `sections` array (17 ids) +
`<section id=…>` blocks; extracted cards live flat in `src/components/*Card.tsx` (`NextcloudCard`,
`ApiTokensCard`, `AISettingsCard`, `AuditLogCard`, …); mutation idiom `update → toast → invalidateQueries`.
Tests: vitest `environment: node`, 15 pure-function test files under `src/lib/**.test.ts`.

---

## 2. Design (recommended)

### 2.1 Key hierarchy and device storage — `src/lib/crypto/` (isomorphic WebCrypto, no deps)
- `dek.ts` — DEK = 32 random bytes; `dek_fingerprint = sha256(dek)` for client-side verification
  (safe: 256-bit random key cannot be brute-forced from a hash).
- `recovery.ts` — recovery code = 160 random bits, base32 as `XXXX-XXXX-…` (8 groups);
  KEK = PBKDF2-SHA256(code, salt, 100k) → AES-KW wrap of DEK. Regenerable while unlocked.
- `hybrid.ts` — per-user P-256 ECDH keypair; `encryptToPublicKey(json, spkiPub)` = ephemeral key +
  HKDF + AES-GCM; `decryptWithPrivateKey`. Private key wrapped under the DEK (AES-GCM).
- `deviceStore.ts` — DEK per user in `localStorage` `cashflow.dek:<uid>` (same trust level as the
  session token beside it); kept across sign-out; explicit "Remove key from this device".
- `src/integrations/supabase/data-key.ts` — in-memory holder (`get/set/clear`).
- Table `public.user_keys` (RLS own rows; `service_role` SELECT for the pubkey):
  `user_id PK, key_version, dek_fingerprint bytea, wrapped_dek_recovery bytea, recovery_kdf jsonb,
  pubkey bytea (SPKI), wrapped_privkey bytea, created_at, updated_at`.

### 2.2 Transport
- Header `x-data-key: <base64 DEK>` on every `/rest/v1/` request: browser via a `global.fetch`
  wrapper in `client.ts` (supabase-js `global.headers` is static; never sent to GoTrue/Storage);
  server functions via `auth-attacher.ts` (forward) and `auth-middleware.ts` (add to the
  request-scoped client's `global.headers`, expose `dataKey` in context). `client.server.ts`
  (service role) never gets a key.
- SQL: `app_crypto.data_key()` = `current_setting('request.headers', true)::json->>'x-data-key'`
  with fallback `current_setting('app_crypto.key', true)` (psql/bench/enroll). Reads never raise
  (service role / cron simply see NULL plaintext). `app_crypto.require_data_key(owner)` raises
  `P0DEK data key required` on INSTEAD OF writes for enrolled owners (an UPDATE without the key
  would otherwise re-encrypt NULLs over real data). `is_enrolled(uuid)` checks the *row owner*.

### 2.3 Database layout
- **Base tables move to schema `private`** (not exposed by PostgREST; Studio shows ciphertext);
  `public.<same name>` becomes a `security_invoker` view. PL/pgSQL resolves names at runtime, so
  the aggregate functions keep working unedited. RLS, FKs, CHECKs, triggers, indexes follow the
  moved tables (`SET SCHEMA` follows OIDs). Grants: `USAGE ON SCHEMA private TO authenticated, service_role`;
  revoke `anon` on the new views.
- **One versioned ciphertext blob per row** (`enc bytea`) holding a JSON of the sensitive columns;
  plaintext columns stay nullable, NULL for enrolled users (opt-in, coexisting, reversible).
  Composite type `app_crypto.<table>_plain` per table.
- **Decrypt exactly once per row** — LATERAL function scan (Postgres has no common-subexpression
  elimination; naive per-column `COALESCE(dec(enc)->>'x', x)` would decrypt 12× per row):
  ```sql
  CREATE VIEW public.transactions WITH (security_invoker = true) AS
  SELECT t.id, t.user_id, t.occurred_on, t.type, t.source_account_id, …,   -- bare refs so PostgREST embedding still maps FKs
         COALESCE(d.amount, t.amount) AS amount, COALESCE(d.description, t.description) AS description, …
  FROM private.transactions t
  CROSS JOIN LATERAL jsonb_populate_record(NULL::app_crypto.transactions_plain, app_crypto.dec(t.enc)) d;
  ```
  `dec` is `STABLE STRICT` (skipped when `enc IS NULL`; plaintext predicates push down to `t`).
- **INSTEAD OF INSERT/UPDATE/DELETE triggers** (one template): `require_data_key(owner)` → validate
  plaintext (moved `amount > 0`, transfer/currency rule, reimbursable defaults, fee clearing) →
  encrypt (enrolled) or write plaintext → `INSERT INTO private.t … RETURNING *` (base triggers
  still fire: `updated_at`, cascades, split-group constraint, audit) → copy every base-generated
  column back into NEW so PostgREST `RETURNING` / `.select().single()` see the real row → plaintext
  side effects (tag sync, reimbursable recompute). View column defaults via
  `ALTER VIEW … ALTER COLUMN … SET DEFAULT` (`gen_random_uuid()`, `auth.uid()`, `CURRENT_DATE`).
  `category_budgets` and `account_statements` INSERT triggers implement upsert on their natural keys.
- Blob versions: `\x01` = `extensions.pgp_sym_encrypt_bytea(json, key, 's2k-mode=0, cipher-algo=aes256, compress-algo=0')`
  (MDC integrity, one hash for key setup); `\x02` = raw `encrypt_iv` AES-256-CBC + `hmac` SHA-256
  encrypt-then-MAC with subkeys `hmac(dek,'enc'|'mac')` — faster fallback; `dec` switches on byte 0.
- **Tags**: `private.transaction_tags(transaction_id, tag_hash bytea, tag_enc bytea, tag text)`,
  PK `(transaction_id, tag_hash)`, `tag_hash = hmac(lower(tag), hmac(dek,'tag'))` (enrolled) or
  `digest(lower(tag),'sha256')` (not enrolled). Read-only view exposes `tag`; only writer is
  `app_crypto.sync_transaction_tags(tx, note, owner)` from the transactions INSTEAD OF path.
- **Audit**: `audit_row_change()` stays SECURITY DEFINER on base tables, becomes key-aware:
  non-sensitive diff in `diff`, sensitive part encrypted into new `diff_enc` (dropped when no
  key); `public.audit_logs` view merges them → `AuditLogCard.tsx` unchanged. Enroll/unenroll set
  `app_crypto.skip_audit` to avoid one audit row per re-encrypted row.
- **Enroll / unenroll** RPCs (`SECURITY INVOKER`, `authenticated` only; the DEK is read from the
  header, never passed as an argument): one transaction that inserts `user_keys` and re-encrypts
  every owned row of every table (owner predicates via `categories`/`recurring_rules` for the two
  tables without `user_id`), re-derives tag hashes, encrypts historical `audit_logs.diff`, writes a
  `crypto.enroll` audit event. `unenroll` is the exact inverse.
- Base constraints relax: sensitive columns drop NOT NULL/DEFAULT; `CHECK (amount IS NULL OR amount > 0)`;
  `CHECK (amount IS NOT NULL OR enc IS NOT NULL [OR enc_pub IS NOT NULL])`.

### 2.4 Existing SQL that genuinely changes
| Object | Change |
|---|---|
| `audit_row_change`, `log_audit_event`, `prune_audit_logs` | rewrite for `private.audit_logs` + `diff_enc` + skip flag |
| `save_split_group` | `SET CONSTRAINTS private.trg_validate_transaction_split_group IMMEDIATE` |
| `apply_recurring_rule_backfill` | two `ON CONFLICT … DO NOTHING` on `pending_transactions` → `IF NOT EXISTS` |
| `process_recurring_rules_for_all_users` | loop `WHERE NOT app_crypto.is_enrolled(user_id)` |
| `sync_transaction_tags` | replaced by `app_crypto.sync_transaction_tags` |
| `default_reimbursable_status`, `clear_non_transfer_fee_fields`, `validate_transaction_destination_amount`, `tx_amount_change_recompute_reimb`, `validate_reimbursement_link`, `validate_category_reallocation`, amount half of `validate_recurring_rule` | base triggers dropped; logic inlined in INSTEAD OF functions |
| VIEWs `account_balances`, `category_savings_balance` | drop + recreate (would silently re-bind to `private.*` on `SET SCHEMA` and read NULLs) |
| `category_savings_balance_series` (+ `_v2`, `reconciliation_summary`, dashboard) | decrypt-once-per-request refactors (see §3) |
| `categories` | new plaintext `system_key` (`'reconcile'`) + partial unique index; replaces `.eq("name", …)` lookups |

Unchanged: `account_balances_as_of`, `category_month_spending`, `category_savings_balance_v2` (body),
`reconciliation_summary` (body), `ensure_month_budgets`, `process_recurring_rules(_if_stale)`,
`archive_*`, `recompute_reimbursable_status`, `preview_recurring_rule`, cascades,
`validate_transaction_split_group`, `validate_pending_transaction_refs`, sweep/scope validators,
`handle_new_user`, `update_updated_at_column`.

### 2.5 Headless and server paths
- **Phone → `POST /api/public/pending-transactions`** (service role, no key): for enrolled users
  read `user_keys.pubkey`, `encryptToPublicKey` the sensitive fields into new `enc_pub bytea`,
  NULL plaintext, skip `labelFromHistory`/`enrichPending`. Generated column
  `needs_rekey = (enc_pub IS NOT NULL AND enc IS NULL)`. **Rekey in the browser** on `/pending`
  mount: fetch `needs_rekey` rows, unwrap private key with the DEK, decrypt,
  `.update({...plain, enc_pub: null})` through the view (INSTEAD OF UPDATE encrypts); then the
  existing enrich-on-mount call runs with the key. Private key never leaves the browser.
  `external_source/external_ref` stay plaintext (dedupe index; phone GET/DELETE by ref).
- **Cron** `api.public.process-recurring.ts`: SQL skips enrolled users; browser sweep carries the key.
- **`POST /api/public/transactions`, `account-statements`, `attachments`** for enrolled users: map
  `P0DEK` → `409 { error: "encryption enabled — send x-data-key or use pending-transactions" }`;
  optionally honour an `x-data-key` header for trusted automations (per-request keyed client).
- **Webhooks**: `loadTransaction` uses the keyed request-scoped client when triggered from
  `notifyTransactionCreated`; cron-triggered dispatch for enrolled users is skipped.
- **AI**: everything already uses the user-JWT client from `requireSupabaseAuth` → works unchanged
  once the header rides along. `enrichPending` takes a keyed client instead of `supabaseAdmin`;
  `writeAudit` for `ai_audit_logs` switches to the keyed client (own-rows INSERT policy) so
  `payload` previews are encrypted.
- **Statement files** (`statement_files` bucket): encrypt bytes with the DEK (AES-GCM in Node)
  before `storage.upload`; serve via a decrypting server function instead of the signed URL.
- **Secrets** (`ai_endpoints.api_token`, `nextcloud_connections.*`, `webhooks.auth_header_value`):
  same view pattern; read only inside keyed requests except the Nextcloud OAuth callback
  (navigation, no key) → encrypt to pubkey + browser rekey like pending.

### 2.6 UX flows
- **Enable** (Settings → new "Encryption" section; card pattern of `NextcloudCard.tsx`, section id
  in the `sections` array + `<section id="encryption">`): explain → generate DEK/keypair/recovery
  code → show recovery code once (copy / download `.txt` / "I have saved it") →
  `app_crypto.enroll(...)` with header → store DEK on device → invalidate queries.
- **Every later visit**: `KeyGate` between `AuthGate` and `I18nGate` in `__root.tsx` loads
  `user_keys`; local DEK with matching `dek_fingerprint` → silent pass-through. Otherwise unlock screen.
- **New device**: (a) transfer code shown by an unlocked device (Settings → "Add a device"; base64
  DEK, 44 chars; QR later), or (b) recovery code. Both verified against `dek_fingerprint`.
- **Lost recovery code**: "Generate new recovery code" rewraps the DEK. **Lost device and code**:
  data unrecoverable — said plainly. Later: DEK rotation (`app_crypto.rekey`, old key from header,
  new from a second header). **Disable**: `app_crypto.unenroll()`.
- Copy: `privacy.tsx` §6/§6a (+ new §6b, EN+DE), `help.tsx` FAQ, `ai.server.ts` help string,
  `architecture.md` (§3.12 + change log), README operator notes (log GUCs, cron behaviour, recovery).

### 2.7 Comfort trade-offs
| Area | Before | After (enrolled) |
|---|---|---|
| Login / daily use | password | unchanged; device remembers the key like the session |
| Balances, envelopes, recurring, splits, insights, search, suggestions | SQL + JS | unchanged |
| AI assistant, statement import, pending suggestions | server-side | unchanged (key rides along) |
| Phone pending rows | suggestions behind the POST | suggestions on next app open (trigger already exists) |
| Cron auto-post + webhooks | headless | on next app open |
| `POST /api/public/transactions` from automations | works | 409 unless the caller sends the key; use pending |
| New device | sign in | sign in + paste transfer/recovery code once |
| Studio / psql browsing | plaintext | ciphertext; `SET app_crypto.key` in psql to inspect |

---

## 3. Performance estimate

Reference: personal DB with N ≈ 5k–20k transactions; other tables ≤ a few hundred rows. Per-row
decrypt (server CPU, small VPS): **pgp (`\x01`) ≈ 20–40 µs**, **raw AES+HMAC (`\x02`) ≈ 5–8 µs**,
`jsonb_populate_record` ≈ 3–5 µs; encrypt ≈ same. Table uses N = 10k with pgp; raw AES ≈ ÷4.
All cost is DB-container CPU; nothing changes on the client, on the wire or in Kong.

| Path | Decrypts | Added latency (pgp) | Note / mitigation |
|---|---|---|---|
| `/transactions` (`fetchTransactions()`, no limit) | N | +0.3 s (on ~0.2 s today) | acceptable; raw AES +0.07 s |
| Dashboard: `account_balances` + `account_balances_as_of` ×2 + `category_month_spending` + `fetchTransactions(500)` | ≈ 3N | +0.9 s | single `dashboard_summary()` RPC decrypting once into a temp relation, or client-side balances from fetched rows → ≈ N |
| `/envelopes`: `category_month_spending` + `category_savings_balance_v2` | ≈ 2N | +0.6 s | `_v2` scans history twice; single decrypted CTE → ≈ N |
| `SavingsHistoryCard` `category_savings_balance_series` (12 months) | ≈ 24N | **+7 s** | **must** refactor: decrypt once into temp table, loop months → ≈ N |
| `/insights` (`fetchTransactionsRange`) | subset | +0.1–0.3 s | fine |
| `/reconcile` | ≈ 3N + N/statement | +0.5–1 s | temp-relation trick |
| Add / edit / split / post | 1–10 rows | < 5 ms | negligible |
| AI briefing (400/1200 rows) + tools (≤ 5000) | ≤ 5k | +0.1–0.15 s | negligible next to model latency |
| `enrichPending` (1500) / statement matching | ≤ 1.5k | +50 ms | negligible |
| Enrol / unenrol | ≈ 1.2N rows | 0.5–1 s per 10k | one transaction |
| Browser pending rekey | rows since last visit | ~1 ms each | negligible |
| Lost index/pushdown: `.eq("name")`, `.not("latitude","is",null)`, AI `ilike` | ≤ N | ≤ a full fetch | `transactions_location_idx` becomes useless; location search already post-filters in JS |
| Storage | — | +30–60 % on `transactions` | raw AES ≈ half; sensitive-column indexes drop |

After the refactors every screen ≈ **one decrypt pass over history per request**: +0.1–0.3 s at
N = 10k with pgp, +0.03–0.08 s with raw AES — comparable to today's JSON serialisation cost.

Benchmark before committing: `scripts/dev/bench-crypto.sql` (20k synthetic rows; time `enc`,
`dec`, `SUM(amount)` for both versions; `EXPLAIN (ANALYZE, BUFFERS)` of the lateral view to confirm
one call per row and pushdown), then end-to-end on a prod clone (`scripts/dev/clone-prod-db.sh`)
timing `SELECT * FROM public.transactions`, `account_balances`, `category_savings_balance_series`,
and one PostgREST request through Kong with `x-data-key`. Rule: largest user's full transaction
read > ~300 ms server-side with pgp → emit `\x02`.

---

## 4. Implementation phases (when resumed)

Every migration wrapped in `BEGIN; … COMMIT;` and ending with `NOTIFY pgrst, 'reload schema';`
(runner is not transactional per file). Functions `SET search_path = public`, fully-qualified `extensions.*`.

**Phase 0 — foundation + benchmark (no behaviour change)**
- `supabase/migrations/<ts>_crypto_foundation.sql`: `pgcrypto` in `extensions`, schemas `private` +
  `app_crypto` + grants, `user_keys` + RLS, `data_key/is_enrolled/require_data_key/enc/dec/enc_text/dec_text/tag_hash/skip_audit`,
  composite `<table>_plain` types; header documents the "add a sensitive column later" recipe
  (type attribute → view → trigger → enroll).
- `scripts/dev/bench-crypto.sql`; choose blob version.
- `src/lib/crypto/{dek,recovery,hybrid,deviceStore}.ts` + tests.
- Compose `db` `command:` += `-c log_statement=none -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0`.

**Phase 1 — core tables, plumbing, enrolment UX**
- Migrations: `_crypto_audit.sql`; `_crypto_dimensions.sql` (accounts, categories + `system_key`,
  category_groups, category_budgets upsert-in-trigger, category_reallocations, settings; recreate
  `category_savings_balance`); `_crypto_transactions.sql` (transactions, transaction_tags,
  transaction_reimbursements, transaction_links, transaction_attachments; `save_split_group` edit;
  recreate `account_balances`); `_crypto_recurring_pending_statements.sql` (recurring_rules/slices,
  pending_transactions + `enc_pub`/`needs_rekey`, account_statements upsert-in-trigger,
  statement_imports/lines; cron skip; backfill `IF NOT EXISTS`; series decrypt-once refactor);
  `_crypto_enroll.sql`.
- Plumbing: `client.ts` fetch wrapper, `data-key.ts`, `auth-attacher.ts`, `auth-middleware.ts`.
- Upsert → insert at `finance.ts:643`, `settings.tsx:191`, `finance.ts:1322`,
  `api.public.account-statements.ts:150`; `links.ts:4-6` → `Tables<>` helper.
- `types.ts`: `user_keys`, RPCs, `pending_transactions.enc_pub/needs_rekey`, `categories.system_key`;
  header note on regeneration; `types.guard.ts` so a naive regen (views typed `never` in `Insert`) fails `tsc`.
- UX: `EncryptionCard.tsx`, `KeyGate`, unlock screen, i18n DE+EN, privacy/help/AI copy.
- Ingestion: pubkey encryption in `api.public.pending-transactions.ts`; browser rekey in `pending.tsx`;
  `enrichPending` keyed client; public POST routes map `P0DEK` → 409; webhook dispatch keyed where possible.
- `architecture.md` §3.12 + change log; README operator notes.

**Phase 2 — AI tables, hot paths, key lifecycle**: `_crypto_ai.sql` (ai_conversations, ai_messages,
ai_audit_logs) + keyed `writeAudit`; `dashboard_summary()` / `_v2` / `reconciliation_summary`
single-pass refactors; QR pairing; new recovery code; DEK rotation.

**Phase 3 — files and secrets**: statement file bytes encrypted with the DEK + decrypting download
function; `ai_endpoints.api_token`, `nextcloud_connections.*`, `webhooks.auth_header_value` via
the view pattern; Nextcloud callback encrypts to pubkey + browser rekey.

---

## 5. Verification (when resumed)
- Unit: `src/lib/crypto/*.test.ts` — round-trips, recovery wrap/unwrap, hybrid encrypt/decrypt,
  fingerprint mismatch.
- SQL smoke (`scripts/dev/crypto-smoke.sql` on the dev stack): checksum every `public.*` view for a
  test user → `SET app_crypto.key` → `enroll` → assert `private.*` plaintext NULL and `enc` set,
  checksums identical, `pg_dump | grep -c '<known description>'` = 0, no stray view bound to
  `private.*`; `unenroll` → checksums identical.
- PostgREST via Kong: GET with header → plaintext; without → NULL sensitive columns; PATCH without
  header → `data key required`, row unchanged; the three embed shapes and insert-then-select; the
  four former upsert sites.
- App: enable, CRUD/split/post, reload (no prompt), all routes; second browser profile via transfer
  and via recovery code; simulated phone POST → `/pending` rekey → suggestions; cron logs skip; AI
  chat + statement import; `AuditLogCard` readable; disable and re-check.
- Performance: phase-0 benchmark + prod-clone timings recorded in `architecture.md`.

---

## 6. Risks and operator requirements
- PostgREST + INSTEAD OF triggers: `RETURNING` reflects only what the trigger returns (copy base
  generated columns back); upserts impossible on views (five sites) — a missed one fails at
  runtime with "no unique or exclusion constraint matching the ON CONFLICT specification".
- Wrong key → `dec` raises per row → loud request failure (desired); client checks `dek_fingerprint` first.
- Key exposure via logs: PostgREST sends the header as a bind parameter (`pg_stat_statements`
  normalises it), but `log_statement=all` or `log_parameter_max_length=-1` would print it → pin the
  GUCs; `src/start.ts` `requestLogger` and Kong must keep not logging headers; DEK never an RPC argument.
- `SET SCHEMA` silently re-binds dependent views — recreate `account_balances`,
  `category_savings_balance`; smoke test asserts nothing else binds to `private.*`.
- `count: exact` on views forces the lateral decrypt per counted row (only service-role code counts today).
- `service_role` bypasses RLS as before; `anon` must be explicitly revoked on the new views.
- Adding a sensitive column later = type attribute + view + trigger + enroll (documented in the
  foundation migration).
- Cron correctness for enrolled users depends on the browser sweep; weeks without opening the app
  = late posts (same as offline users today).
- Cloudflare Workers target: prefer WebCrypto over `node:crypto` for everything new.
