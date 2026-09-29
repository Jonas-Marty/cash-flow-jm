# Envoy gateway — read before changing anything here

These files are the API gateway for **both** Supabase stacks. Both build
them into an image (`docker/envoy/Dockerfile`, compose `build:`), from git:

| stack | Dokploy compose | branch |
|---|---|---|
| **dev** | Cash Flow → dev → `supabase-dev` | `dev` |
| **prod** | Cash Flow → production → `supabase` | `main` |

A change here reaches a stack with its **normal deploy**: the image is
rebuilt, and compose recreates the Envoy container because the image changed.
No File Mounts to paste into, and no manual restart.

## Don't forget

1. **Check the log for `rejected`** after a deploy that changed these files.
   Envoy keeps running with a config it rejects and serves nothing useful:
   `docker logs <envoy container> 2>&1 | grep -i rejected`
   (prod `cash-flow-supabase-e2meaa-supabase-envoy`,
   dev `cash-flow-supabasedev-wl3ygi-envoy-1`).
2. **Try dev first**, then run the checks in `docs/gateway-migration.md`
   (401 without a key, 200 with the anon key, 404 for unknown paths, …)
   against both hosts.
3. **Quick local check** before pushing — build and start the image with
   dummy keys and look for the listener:
   ```sh
   docker build -f docker/envoy/Dockerfile -t envoy-check .
   docker run -d --name envoy-check -e ANON_KEY=a -e SERVICE_ROLE_KEY=b --entrypoint /bin/sh envoy-check /docker-entrypoint.sh
   docker logs envoy-check 2>&1 | grep -i -E "rejected|add/update listener"
   docker rm -f -v envoy-check && docker rmi envoy-check
   ```

`${ANON_KEY}` and `${SERVICE_ROLE_KEY}` in `lds.template.yaml` are filled in by
`docker-entrypoint.sh` at start, from the container environment; the keys are
never part of the image. Never paste real keys into these files.

## What it does

- Routes `/auth/v1/`, `/rest/v1/` and `/storage/v1/` to GoTrue, PostgREST and
  Storage; everything else is a 404.
- Requires one of the two keys on the protected routes (Lua + RBAC), and uses
  the apikey as bearer token when no JWT is sent.
- Compresses JSON responses over 1 KB (Brotli when the browser offers it,
  else gzip). The full transaction list is about 1 KB of JSON per row.

Background and the Kong → Envoy decision: `docs/gateway-migration.md`.
