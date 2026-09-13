# Trimming the production Supabase stack

Status: applied to production on 2026-09-13, through the Dokploy API, after a
fresh backup (`db/cashflow/2026-09-13T19-54-35-173Z.sql.gz`). Sign-in and the
REST/auth/storage gateway checks passed. Two deviations from the runbook below:

- **Kong runs two nginx workers** (`KONG_NGINX_WORKER_PROCESSES: 2`). With the
  default of one per core it held ~940 MB against its 1g limit — the earlier
  54 MB reading was taken while most of it sat in swap. Two workers: ~180 MB.
- **`supabase/edge-runtime:v1.67.4` must not be removed** in step 7: the
  ovtrack stack on the same host still runs it.

## Why

Production ran the full 13-service upstream Supabase stack. Measured on the
host:

| service | RSS | |
|---|---|---|
| analytics (logflare) | 1549 MB | dropped |
| kong | 107 MB | kept |
| db | 90 MB | kept |
| supavisor (pooler) | 75 MB | dropped |
| studio | 75 MB | kept |
| rest | 68 MB | kept |
| storage | 54 MB | kept |
| realtime | 51 MB | kept |
| meta | 47 MB | kept |
| vector | 27 MB | dropped |
| imgproxy | 15 MB | kept |
| auth | 9 MB | kept |
| functions (edge runtime) | 1.5 MB | dropped |

`analytics` alone was the largest single memory consumer on the whole machine —
ahead of Dokploy, Plex, Unifi and Authentik — while the host sat at 14.0 of
15.9 GB with 4.3 GB of swap in use.

None of the four dropped services is reachable from the application:

- **analytics / vector** — nothing reads the logs. `_analytics` was 128 MB of
  the 137 MB `_supabase` database; the app's own database is 16 MB. `vector`
  existed only to feed logflare, and bind-mounted `/var/run/docker.sock`.
- **supavisor** — zero established sessions, yet it held 27 of the database's
  100 `max_connections` for its own bookkeeping, and published
  `0.0.0.0:5432` and `0.0.0.0:6543` with no firewall rules in front of them.
  The migrate sidecar and `scripts/dev/*` connect to `db:5432` directly.
- **functions** — no `supabase.functions.invoke` call anywhere and no
  `supabase/functions/` directory. The recurring-rules and audit-prune jobs
  are token-guarded HTTP routes hit by host cron (README section 5).

Expected: **~2.1 GB → ~515 MB resident**, ~2.26 GB of images and 137 MB of
database reclaimed, two public Postgres ports closed.

`realtime` and `imgproxy` are kept despite being unused today (the
`supabase_realtime` publication has 0 tables; no storage call passes a
`transform:` option), as is Kong, so the stack still matches what Lovable
generates against.

## What you give up

- **No edge-functions runtime.** `/functions/v1/*` returns 404 at the gateway.
  If Lovable ever emits a function, restore the `functions` service block and
  the `functions-v1` route — both are in git history, ~15 lines each.
- **Studio's Logs pages.** They were logflare's only consumer, so
  `NEXT_PUBLIC_ENABLE_LOGS` is now `false`. Table browsing, SQL editor and the
  rest of Studio are unaffected.

## Runbook

The deployed compose lives in Dokploy's database (`sourceType: raw`), edited
through the UI — a git push will not move it. Dokploy resource: project
**Cash Flow → production → supabase** (`cash-flow-supabase-e2meaa`).

**1. Back up first.** Backups tab → run `backup-copy-neural-capacitor-pslgvo`
manually and confirm a fresh object under `/db/cashflow` in the Garage S3
bucket `dokploy-backup`. It dumps the `postgres` database as `supabase_admin`
— exactly the data that matters. `_supabase` holds only analytics and pooler
state, which this change discards on purpose.

**2. Kong config.** Advanced → File Mounts → `/volumes/api/kong.yml` → replace
with the contents of `docker/prod-supabase/kong.yml`.

**3. Delete the dead file mounts:**

    /volumes/logs/vector.yml
    /volumes/pooler/pooler.exs
    /volumes/functions/main/index.ts
    /volumes/functions/hello/index.ts
    /volumes/db/_supabase.sql
    /volumes/db/logs.sql
    /volumes/db/pooler.sql

The three `.sql` ones bootstrap the `_supabase` database and the `_analytics` /
`_supavisor` schemas on a *fresh* volume; they have no effect on the existing
data directory. Keep `realtime.sql`, `roles.sql`, `jwt.sql`, `webhooks.sql`.

**4. Compose.** Replace the compose file with
`docker-compose.prod-supabase.yml`. Do not paste the `traefik.*` labels — the
Domains tab injects those.

**5. Environment tab — remove:**

    LOGFLARE_API_KEY  LOGFLARE_LOGGER_BACKEND_API_KEY
    GOOGLE_PROJECT_ID  GOOGLE_PROJECT_NUMBER
    DOCKER_SOCKET_LOCATION
    POOLER_PROXY_PORT_TRANSACTION  POOLER_DEFAULT_POOL_SIZE
    POOLER_MAX_CLIENT_CONN  POOLER_TENANT_ID
    VAULT_ENC_KEY  FUNCTIONS_VERIFY_JWT

Keep `SECRET_KEY_BASE` — supavisor and realtime shared it and realtime stays.
Keep `POSTGRES_PORT` — every remaining connection string interpolates it.

**6. Deploy** and watch the logs.

**7. Reclaim disk**, only once step 8 passes:

```bash
docker exec cash-flow-supabase-e2meaa-supabase-db psql -U postgres -c 'DROP DATABASE _supabase;'
docker image rm supabase/supavisor:2.5.1 \
                supabase/logflare:1.12.0 timberio/vector:0.28.1-alpine
```

**Rollback:** re-paste the previous compose and `kong.yml` from git history and
redeploy. Nothing here writes to the data directory — the `postgres` database
lives in a bind mount at `files/volumes/db/data` that no step above touches.

## Verification

Baseline, before you start:

```bash
docker stats --no-stream --format '{{.MemUsage}}\t{{.Name}}' | grep cash-flow-supabase
```

After the redeploy:

1. **Container set** — nine services, all healthy:
   `db auth rest storage realtime imgproxy meta studio kong`. No container
   named `…-analytics`, `…-vector`, `…-pooler` or `…-edge-functions`.
2. **Memory** — rerun the `docker stats` line; total should be ~515 MB, and
   `free -m` should show ~1.6 GB more available.
3. **Ports closed** — `ss -tlnp | grep -E ':(5432|6543)'` returns nothing.
4. **Connections freed** —
   `select count(*) from pg_stat_activity where backend_type='client backend'`
   drops by ~27.
5. **Gateway** —
   - `curl -fsS https://cash-flow-supabase.wi-wo.ch/auth/v1/health`
   - `curl -fsS -H "apikey: $ANON_KEY" https://cash-flow-supabase.wi-wo.ch/rest/v1/`
   - `curl -sS -o /dev/null -w '%{http_code}\n' https://cash-flow-supabase.wi-wo.ch/functions/v1/hello`
     → expect **404** (route removed), not 502.
6. **App smoke test** in a browser — these cover every Supabase feature the app
   actually uses:
   - Sign in with password, dashboard renders (GoTrue, PostgREST, the 15 RPCs).
   - Settings → Linked accounts loads (`getUserIdentities`).
   - Settings → icon picker → upload an image, it renders from the public URL
     (`account-category-images`, `src/components/IconPicker.tsx`).
   - Statements → upload a PDF, then open it (`statement-files` +
     `createSignedUrl`, `src/utils/statements.detail.server.ts`).
   - `curl -H "Authorization: Bearer $METRICS_TOKEN" https://<app>/api/public/metrics`
     — the server-side service-role path through Kong.
7. **Studio** — open the dashboard domain and browse a table. Logs pages error;
   that is the accepted regression.
8. **Backup still green** — run the Dokploy backup once more and confirm a
   fresh object in the bucket.
