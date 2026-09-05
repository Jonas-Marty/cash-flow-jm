# Cash-Flow

Personal finance tracker — mobile-first, multi-account, envelope budgeting, IOU
management, recurring rules, scoped views, optional Nextcloud attachments and a
public REST API.

Stack: TanStack Start v1 (React 19, Vite 7), Tailwind v4, Supabase Postgres.
The reference deployment runs as a Node SSR container against a self-hosted
Supabase instance.

For domain model, business rules and SQL surface, see [`architecture.md`](./architecture.md).

---

## 1. Local development

Prerequisites: [bun](https://bun.sh) (the lockfile is `bun.lock`) and a
reachable Supabase project (hosted or self-hosted). Installs, the build and
the tests all run on bun, locally and in the Docker image, so a green run
here means the same thing as a green image build. The server itself still
runs on Node 22 — that is what `dist/server` targets and what the runtime
image ships.

npm works too, but only from npm 12 — npm 10, the one bundled with node 22,
crashes on this dependency graph with `Cannot read properties of null
(reading 'edgesOut')`.

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# edit .env and set:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_PUBLISHABLE_KEY
#   VITE_SUPABASE_PROJECT_ID

# 3. Start the dev server
bun run dev
```

Run the test suite (either runtime — the results are identical):

```bash
bunx vitest run
```

Note for anything importing `zod`: use `import * as z from "zod"`, not
`import { z } from "zod"`. zod's entry point re-exports `z` as a namespace
binding, which bun's ESM implementation resolves to `undefined`, so the named
form fails under `bunx` while working under node.

---

## 2. Database migrations

All schema lives in `supabase/migrations/*.sql`, applied in filename order. The
repo ships a migration runner image that you can point at any Postgres URL.

### Build the migrator image

```bash
docker build -f Dockerfile.migrate -t cash-flow-migrate .
```

### Run against an existing Supabase database

```bash
docker run --rm \
  -e DATABASE_URL="postgres://postgres:<password>@<host>:5432/postgres" \
  cash-flow-migrate
```

The runner (`docker/migrate/run-migrations.sh`):

- Waits for the database to be reachable.
- Creates `public.schema_migrations(version, applied_at)` if missing.
- Applies each `*.sql` file that has not yet been recorded.
- Stops on the first error (`ON_ERROR_STOP=1`).

It is idempotent — re-running it on an up-to-date database is a no-op. The same
image is invoked automatically as the `migrate` service in `docker-compose.yml`
before `app` starts.

---

## 3. Building the app container

The app is a Node SSR build (Vite, Express) — no Worker runtime, no Vinxi.

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://your-supabase.example.com \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=eyJ... \
  -t cash-flow-app .
```

The two `VITE_*` build args are baked into the client bundle at build time and
must match the Supabase project the runtime will talk to.

At runtime, the container reads:

| Var | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Client-side Supabase URL (also baked into the JS bundle) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Client-side anon key |
| `SUPABASE_URL` | yes | Server-side Supabase URL (defaults to `VITE_SUPABASE_URL`) |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Server-side anon key (mirrors the publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key for admin operations (audit log writes, cron, public-API admin paths) |
| `METRICS_TOKEN` | yes | Bearer token guarding `/api/public/metrics`, `/api/public/prune-audit`, `/api/public/process-recurring` |
| `AUDIT_RETENTION_DAYS` | no (default 365) | Retention window for `prune_audit_logs` |
| `NEXTCLOUD_BASE_URL` / `NEXTCLOUD_CLIENT_ID` / `NEXTCLOUD_CLIENT_SECRET` | no | OAuth credentials for the Nextcloud attachments integration |
| `LOG_SERVICE_NAME` | no (default `cash-flow`) | Sets `service` field in JSON logs |
| `PORT` / `HOST` | no (defaults `3000` / `0.0.0.0`) | Node SSR listen address |

---

## 4. Deploying with Docker Compose

`docker-compose.yml` defines two services:

- `migrate` — runs migrations once and exits successfully.
- `app` — builds the SSR image, waits for `migrate`, then serves on port `3000`.

It joins an external `supabase` network (`SUPABASE_DOCKER_NETWORK`) so the app
can reach the Supabase containers (Kong, Postgres, etc.) by service name.

### Deploy against a self-hosted Supabase instance

1. Stand up your Supabase stack (Kong gateway, Postgres, GoTrue, etc.) on a
   Docker network — e.g. the official `supabase/docker` compose project. Note
   the network name.
2. Create a `.env` file next to `docker-compose.yml`:

   ```bash
   SUPABASE_DOCKER_NETWORK=supabase_default

   # Internal URL the migrator uses (Postgres, inside the Docker network)
   SUPABASE_DB_URL=postgres://postgres:<password>@db:5432/postgres

   # Public URL clients reach (Kong, exposed via your reverse proxy / TLS)
   VITE_SUPABASE_URL=https://supabase.example.com
   VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOi...

   # Internal URL the app's server-side code uses (Kong, inside the network)
   SUPABASE_URL=http://kong:8000
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...service-role...

   METRICS_TOKEN=<long random string>
   AUDIT_RETENTION_DAYS=365
   ```

3. (Optional, local-only) Override published ports:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
   ```

4. Production build & start:

   ```bash
   docker compose up -d --build
   ```

The `migrate` service runs first; once it exits 0, `app` starts and listens on
`3000`. Put it behind your reverse proxy (Traefik / nginx / Caddy) with TLS.

### Hosted-Supabase variant

If you point at hosted Supabase instead of a self-hosted stack, drop the
`networks: supabase` block and set `SUPABASE_DB_URL` to the hosted database's
connection string (Supabase Dashboard → Project Settings → Database).

---

## 5. Scheduled tasks (cron)

The default behaviour is **lazy / app-driven**: `process_recurring_rules(today)`
runs whenever a user loads the dashboard. Auto-post rules only materialise into
transactions when someone opens the app. For a single user who opens the app
regularly this is fine — the next visit catches up everything in one batch.

If you want auto-posts (and pending-occurrence promotions) to land **without**
anyone opening the app, wire up a scheduled job. Three options, in order of
simplicity. **Option A is implemented**; B and C are documented for completeness.

### Option A — host-level cron (recommended)

No extra container, no extensions. Add a cron entry on the Docker host that
hits the bundled HTTP endpoint:

```cron
# /etc/cron.d/cash-flow-recurring  — every hour at :05
5 * * * * root curl -fsS -X POST -H "Authorization: Bearer ${METRICS_TOKEN}" \
    https://app.example.com/api/public/process-recurring > /dev/null
```

Pieces that ship with the app:

1. **Endpoint** `src/routes/api.public.process-recurring.ts`. Accepts `GET` or
   `POST`, requires `Authorization: Bearer ${METRICS_TOKEN}`. Optional
   `?today=YYYY-MM-DD` query param for backfills (defaults to the server's
   local date). Returns `{ users_processed, today }`. Same auth pattern as
   `api.public.prune-audit.ts`.
2. **SQL function** `public.process_recurring_rules_for_all_users(p_today date)
   RETURNS integer`. `SECURITY DEFINER`, locked down so only `service_role` can
   `EXECUTE` (the endpoint uses `supabaseAdmin`). Iterates every active rule
   owner and runs the standard two-pass logic (promote due pendings, then
   extend the schedule forward).

`${METRICS_TOKEN}` must match the value in the app's environment. Hourly is
generous — once a day shortly after midnight is enough for typical use; hourly
only matters if you have rules whose `effective_on` lands mid-day.

### Option B — `pg_cron` inside the database container

`supabase/postgres` ships `pg_cron` enabled. A scheduled SQL job can call the
bulk processor directly:

```sql
SELECT cron.schedule(
  'process-recurring-hourly',
  '5 * * * *',
  $$ SELECT public.process_recurring_rules_for_all_users(CURRENT_DATE); $$
);
```

Pros: zero network hops, runs even if the `app` container is down. Cons:
harder to observe (no app logs, no `METRICS_TOKEN` audit trail) and `pg_cron`
runs as `postgres`, so you'd also need to `GRANT EXECUTE` on the bulk
function to that role.

### Option C — `pg_net` from `db` calling the app

Same shape as Lovable Cloud's hosted cron pattern: `pg_cron` triggers
`net.http_post(...)` against `/api/public/process-recurring`. Effectively a
worse Option A — adds a network hop and an extension dependency for no gain
on a single-host setup.

### Audit-log retention

`prune_audit_logs` honours `AUDIT_RETENTION_DAYS` (default 365). Schedule it
the same way:

```bash
# Nightly retention prune
curl -X POST -H "Authorization: Bearer $METRICS_TOKEN" \
     https://app.example.com/api/public/prune-audit
```

---

## 6. Observability

The app emits one JSON line per event to stdout (info/debug) or stderr
(warn/error). Promtail / Filebeat / Vector can pick it up directly from the
container — no extra log files, no rotation needed inside the app. Field
shape and the audit-log layer are documented in
[`architecture.md` §8](./architecture.md#8-logging-auditing--metrics--also-referenced-as-313).

### Prometheus scrape

`/api/public/metrics` exposes the standard text exposition format, protected
by the `METRICS_TOKEN` Bearer header:

```yaml
- job_name: cash-flow
  metrics_path: /api/public/metrics
  authorization:
    type: Bearer
    credentials: <METRICS_TOKEN>
```

Pre-registered counters: `app_requests_total`, `app_request_errors_total`,
`app_request_duration_ms_sum`, `app_audit_events_total`. Business gauges
(users, transactions, recent audit events) are computed inside the handler.

---

## 7. Public API

Token-authenticated REST endpoints live under `/api/public/*`. The Swagger UI
is served at `/api/public/docs` and the raw OpenAPI document at
`/api/public/openapi`. Tokens are managed in **Settings → API tokens**.

---

## 8. Dev environment

A second, throwaway copy of the whole stack, so a change can be looked at in a
real browser before it reaches production.

```
   push to `dev`                      dev-cash-flow.wi-wo.ch
        │                                      │
   Dokploy: cash-flow-dev-app  ────────────────┘
        │  (docker-compose.yml, APP_IMAGE=cash-flow-app:dev)
        ↓
   Dokploy: cash-flow-dev-supabase   ← dev-cash-flow-supabase.wi-wo.ch
      (docker-compose.dev-supabase.yml: db, auth, rest, storage, kong)
```

Production is never involved: the dev stack has its own JWT secret, its own
anon/service keys and its own database volume. The only thing it takes from
production is a copy of the data, and only ever by reading it.

### First-time setup

1. `docker network create cash-flow-dev-supabase` — the fixed network both
   resources join.
2. `bash docker/scripts/gen-keys.sh` and fill in `.env.dev-supabase`
   (see `.env.dev-supabase.example`).
3. In Dokploy, create a **Compose** resource `cash-flow-dev-supabase` from this
   repository, branch `dev`, compose path `./docker-compose.dev-supabase.yml`,
   paste that env, deploy, then add the domain
   `dev-cash-flow-supabase.wi-wo.ch` → service `kong`, port `8000`.
4. `bash scripts/dev/clone-prod-db.sh` — copies production into it.
5. Create a second **Compose** resource `cash-flow-dev-app`, branch `dev`,
   compose path `./docker-compose.yml`, **auto-deploy on**, domain
   `dev-cash-flow.wi-wo.ch` → service `app`, port `3000`, with:

   | Variable | Value |
   | --- | --- |
   | `APP_IMAGE` | `cash-flow-app:dev` (keeps production's `:latest` intact) |
   | `SUPABASE_DOCKER_NETWORK` | `cash-flow-dev-supabase` |
   | `SUPABASE_DB_URL` | `postgresql://supabase_admin:<POSTGRES_PASSWORD>@db:5432/postgres` |
   | `VITE_SUPABASE_URL`, `SUPABASE_URL` | `https://dev-cash-flow-supabase.wi-wo.ch` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` | dev `ANON_KEY` |
   | `SUPABASE_SERVICE_ROLE_KEY` | dev `SERVICE_ROLE_KEY` |
   | `METRICS_TOKEN` | a fresh one — do **not** point cron at dev |
   | `LOG_SERVICE_NAME` | `cash-flow-dev` |

Log in on dev with your production credentials: password hashes survive the
clone, sessions do not.

### Day to day

```bash
git switch dev && git push          # dev auto-deploys, then merge to main

bun run dev:clone-db                # re-copy production into dev
bun run dev:clone-db -- --with-storage --migrate
bun run dev:reset-db                # throw the dev database away

# Browser toolbox (Playwright + bun in a container; the host has neither)
bun run dev:tools                              # shell in the toolbox
bun run dev:tools -- bun run lint
DEV_LOGIN_EMAIL=… DEV_LOGIN_PASSWORD=… \
  bun run dev:screenshot -- --login --mobile --path /pending
```

`dev:screenshot` writes full-page PNGs plus the console output per viewport to
`screenshots/`, and reports how far each page overflows its viewport
horizontally — which is what mobile layout bugs look like from the outside.
Point it at a local `bun run dev` with `--url http://localhost:8080`.

Health checks (from a container on the `cash-flow-dev-supabase` network, or
from anywhere once the domain is up):

```bash
curl -H "apikey: $ANON_KEY" https://dev-cash-flow-supabase.wi-wo.ch/auth/v1/health
curl -o /dev/null -w '%{http_code}\n' -H "apikey: $ANON_KEY" \
  https://dev-cash-flow-supabase.wi-wo.ch/rest/v1/     # 200; 401 without the key
curl https://dev-cash-flow.wi-wo.ch/api/public/version # should report the dev commit
```

The clone script copies `public`, `auth` and `storage`, then blanks the
Nextcloud tokens and deactivates the webhooks, so a dev instance cannot act on
the outside world. AI credentials and API tokens are kept so those paths stay
testable — see `scripts/dev/scrub-dev.sql`.

---

## 9. License

See repository for license details: https://github.com/Jonas-Marty/cash-flow-jm