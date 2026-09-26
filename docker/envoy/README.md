# Envoy gateway — read before changing anything here

These four files are the API gateway for **both** Supabase stacks, but they
reach the two stacks differently:

| | how the files get there | after a change |
|---|---|---|
| **dev** | mounted straight from this directory (git source) | push, redeploy, **restart the envoy container** |
| **prod** | **copies** in Dokploy → Cash Flow → production → supabase → Advanced → File Mounts, `/volumes/api/envoy/<file>` | **paste the new content into the matching File Mount by hand**, then **restart the envoy container** |

## Don't forget

1. **Prod does not follow git.** Editing a file here changes nothing on prod
   until you paste it into its File Mount. Keep the four mounts identical to
   this directory.
2. **A redeploy does not restart Envoy** when only these files change (the
   service definition is unchanged). Restart the container yourself:
   `docker restart cash-flow-supabase-e2meaa-supabase-envoy` (prod),
   `docker restart cash-flow-supabasedev-wl3ygi-envoy-1` (dev).
3. **Check the log for `rejected`** after the restart. Envoy keeps running
   with a config it rejects and serves nothing useful:
   `docker logs <envoy container> 2>&1 | grep -i rejected`
4. **Try dev first**, then run the checks in `docs/gateway-migration.md`
   (401 without a key, 200 with the anon key, 404 for unknown paths, …)
   against both hosts.

`${ANON_KEY}` and `${SERVICE_ROLE_KEY}` in `lds.template.yaml` are filled in by
`docker-entrypoint.sh` at start; never paste real keys into these files.

Background and the Kong → Envoy decision: `docs/gateway-migration.md`.
