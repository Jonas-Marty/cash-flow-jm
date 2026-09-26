# Replacing Kong with Envoy

**Status 2026-09-26: done.** Upstream's Envoy (option A below) is the gateway on
dev (since 2026-09-25) and prod (since 2026-09-26). Kong is removed from both.

## Why

- **Kong 2.8 is end of life.** 2.8.5 is the last release (a hash-collision DoS
  fix); the open-source 3.x line froze at 3.9 and loses support 2026-12-12.
- **Upstream moved on.** Supabase's self-hosting stack uses Envoy by default
  since self-hosted v0.8.0; security fixes to the gateway config now land in
  Envoy's files first (e.g. blocking Realtime's `/api/tenants`).
- **Kong is our heaviest service for what it does.** 1 GB memory limit, two
  nginx workers pinned by hand, and a `bash -c 'eval "echo …"'` entrypoint that
  shell-expands the whole config file.

## What the gateway has to do for us

After the 2026-09-25 trims (no realtime, imgproxy, graphql, functions,
analytics; Studio/meta on their way out) the job is small:

| Path | Upstream | Key check | Notes |
|---|---|---|---|
| `/auth/v1/verify`, `/auth/v1/callback`, `/auth/v1/authorize` | auth:9999 | none | browser redirects, no headers possible |
| `/auth/v1/*` | auth:9999 | apikey = anon or service | |
| `/rest/v1/*` | rest:3000 | apikey = anon or service | apikey stripped before PostgREST (`hide_credentials`) |
| `/storage/v1/*` | storage:5000 | none (storage checks the JWT) | needs `X-Forwarded-Prefix: /storage/v1` for TUS/S3 URLs |
| anything else | — | — | 404 |

Plus CORS for every route (the browser app calls from `cash-flow.wi-wo.ch`),
answered at the gateway including preflights. TLS stays in Traefik.

The key check is defence in depth, not the boundary: PostgREST and GoTrue
verify the JWT themselves, and the anon key is public (it ships in the app's
JavaScript). It keeps drive-by scanners away and matches Kong's behaviour.

## Options

**A. Upstream Envoy (`envoyproxy/envoy`), template trimmed to the table above.**
+ Same gateway as upstream; their future fixes can be ported route by route.
+ Proper key check (Lua filter), opaque `sb_*` key support if ever wanted.
− Upstream's template is ~50 KB of YAML for ~20 routes; trimmed to ours it is
  still several hundred lines of Envoy config plus a Lua filter, rendered by a
  `sed` entrypoint. Harder to read and to debug than what it replaces.

**B. nginx, as ov-track already does** (`/work/ov-track/docker/gateway/default.conf.template`).
+ ~100 lines anyone can read; same pattern as the other project on this host.
+ `nginx:alpine`, a few MB of memory; envsubst limited to named variables
  instead of `eval`.
+ Exact key check with a `map $http_apikey $key_ok { "${ANON_KEY}" 1; "${SERVICE_ROLE_KEY}" 1; default 0; }`
  (ov-track only checks that the header is non-empty — tighten that here).
− Our own config, not upstream's: we port relevant upstream changes by hand
  (we already do, since our Kong file is trimmed).

**Chosen: A** — staying on upstream's gateway, so their gateway fixes port over
route by route. `docker/envoy/` is their config trimmed to auth, rest and
storage with the legacy keys, and on current (non-deprecated) Envoy 1.39 config
forms. Differences from Kong: the OpenAPI root `/rest/v1/` needs the service
key, and unknown paths get a plain 404.

**Gotcha:** a Dokploy redeploy does not restart Envoy when only the files under
`docker/envoy/` change (the service definition is unchanged) — restart the
container after changing them, and check its log for `rejected`.

## Rollout

1. **Dev — done.** Envoy ran next to Kong, passed the checks below inside the
   network, then took the domain; Kong, Studio and pg-meta were removed.
2. **Prod — done 2026-09-26.** The four files in `docker/envoy/` are Dokploy
   File Mounts under `/volumes/api/envoy/`, the compose runs `envoy` in place
   of `kong`, and the Domains entry `cash-flow-supabase.wi-wo.ch` points at
   `envoy:8000`; the `kong.yml` mount is deleted. When a file in
   `docker/envoy/` changes, update the matching File Mount by hand, then
   restart the Envoy container (see the gotcha above). Git history has the
   Kong setup for a fix-back.
3. The blackbox probe for the Supabase host must target a path that answers 200
   (`/storage/v1/status`): `/` is a 404 now.

## Checks (dev, then prod)

- `GET /auth/v1/health` without apikey → 401; with anon key → 200.
- `GET /rest/v1/accounts` with a wrong apikey → 401; with anon key → 200
  (RLS returns `[]` for anon).
- `OPTIONS /rest/v1/accounts` with `Origin` + `Access-Control-Request-Headers:
  apikey,authorization,content-type,x-client-info` → 204 with matching CORS
  headers.
- `GET /auth/v1/authorize?provider=custom:oidc` → 302 to Authentik;
  `/auth/v1/callback` and `/auth/v1/verify` reachable without apikey.
- Storage: upload, public URL, signed URL, delete (as tested for the Storage
  upgrade); a resumable (TUS) upload's `Location` keeps the `/storage/v1` prefix.
- `/realtime/v1/…`, `/pg/…`, `/` → 404.
- `scripts/dev/smoke.mjs` → no problems; sign-in with Authentik end to end.
- The server-side service-role path: `/api/public/metrics` with its token.
