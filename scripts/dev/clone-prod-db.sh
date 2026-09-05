#!/usr/bin/env bash
# Copy the production database into the throwaway dev Supabase stack.
#
# Production is only ever read: the single command that touches it is pg_dump.
# Everything destructive happens on the dev side, which the script refuses to
# run against anything whose compose project is not clearly the dev one.
#
#   scripts/dev/clone-prod-db.sh [--yes] [--with-storage] [--migrate] [--keep-dump]
#
# Env: DEV_PROJECT (dev compose project, autodetected), PROD_DB_CONTAINER.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# shellcheck source=scripts/dev/lib.sh
source scripts/dev/lib.sh

ASSUME_YES=0 WITH_STORAGE=0 RUN_MIGRATE=0 KEEP_DUMP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --with-storage) WITH_STORAGE=1 ;;
    --migrate) RUN_MIGRATE=1 ;;
    --keep-dump) KEEP_DUMP=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# ---------------------------------------------------------------- preflight --
docker inspect "$PROD_DB_CONTAINER" >/dev/null 2>&1 \
  || die "production db container '$PROD_DB_CONTAINER' not found"

DEV_PROJECT_NAME=$(detect_dev_project)
assert_is_dev_project "$DEV_PROJECT_NAME"

DEV_DB=$(find_container "$DEV_PROJECT_NAME" db)
[ -n "$DEV_DB" ] || die "no running 'db' service in compose project '$DEV_PROJECT_NAME'"
DEV_AUTH=$(find_container "$DEV_PROJECT_NAME" auth)
DEV_REST=$(find_container "$DEV_PROJECT_NAME" rest)
DEV_STORAGE=$(find_container "$DEV_PROJECT_NAME" storage)

health=$(docker inspect "$DEV_DB" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
[ "$health" = "healthy" ] || die "dev db is '$health', not healthy — wait for it or redeploy"

info "source (read-only): $PROD_DB_CONTAINER"
info "target (rewritten): $DEV_DB  [project $DEV_PROJECT_NAME]"
if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Replace the dev database with a copy of production? [y/N] " reply
  case "$reply" in y|Y|yes) ;; *) die "aborted" ;; esac
fi

# --------------------------------------------------------------------- dump --
DUMP="/tmp/cash-flow-prod-$(date +%Y%m%d-%H%M%S).dump"
cleanup() { [ "$KEEP_DUMP" -eq 1 ] || rm -f "$DUMP"; }
trap cleanup EXIT

info "dumping public + auth + storage from production"
# supabase_admin is the superuser here (postgres is not) and owns public.*;
# auth.* and storage.* belong to their own admin roles, which exist identically
# on dev because both run the same image.
( umask 077; docker exec "$PROD_DB_CONTAINER" \
    pg_dump -U supabase_admin -d postgres -Fc \
      --schema=public --schema=auth --schema=storage \
      ${EXCLUDE_LEDGERS:+--exclude-table-data=auth.schema_migrations --exclude-table-data=storage.migrations} \
    > "$DUMP" )
info "dump size: $(du -h "$DUMP" | cut -f1)"

# ------------------------------------------------------------------ restore --
# GoTrue, PostgREST and Storage hold connections and cache the schema; stopping
# them keeps the restore from fighting live traffic.
stopped=()
for c in "$DEV_AUTH" "$DEV_REST" "$DEV_STORAGE"; do
  [ -n "$c" ] || continue
  docker stop "$c" >/dev/null && stopped+=("$c")
done
[ ${#stopped[@]} -gt 0 ] && info "paused ${#stopped[@]} dev services during the restore"

restart_services() {
  for c in "${stopped[@]:-}"; do [ -n "$c" ] && docker start "$c" >/dev/null || true; done
}

info "restoring into dev"
# --clean --if-exists drops each archived object first (the archive covers the
# whole graph: FKs into auth.users, the on_auth_user_created trigger, storage
# policies), --single-transaction leaves dev untouched if anything fails.
if ! docker exec -i "$DEV_DB" pg_restore -U supabase_admin -d postgres \
       --clean --if-exists --single-transaction --exit-on-error < "$DUMP"; then
  restart_services
  die "restore failed — dev is unchanged. Run scripts/dev/reset-dev-db.sh and retry."
fi

# -------------------------------------------------------------------- scrub --
info "scrubbing outbound credentials"
psql_dev "$DEV_DB" -q < scripts/dev/scrub-dev.sql

# ------------------------------------------------------------------ storage --
if [ "$WITH_STORAGE" -eq 1 ]; then
  if [ -z "$DEV_STORAGE" ]; then
    warn "no dev storage service; skipping file copy"
  else
    info "copying storage objects"
    # The production path is root-only, but the docker daemon reads it, and
    # --volumes-from spares us guessing Dokploy's generated volume name.
    docker run --rm --volumes-from "$DEV_STORAGE" \
      -v "$PROD_STORAGE_DIR:/src:ro" alpine:3 \
      sh -c 'cp -a /src/. /var/lib/storage/ 2>/dev/null; du -sh /var/lib/storage'
  fi
fi

restart_services
info "waiting for dev services to come back"
for _ in $(seq 1 30); do
  ok=1
  for c in "${stopped[@]:-}"; do
    [ -n "$c" ] || continue
    st=$(docker inspect "$c" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
    case "$st" in healthy|running) ;; *) ok=0 ;; esac
  done
  [ "$ok" -eq 1 ] && break
  sleep 2
done
# PostgREST caches the schema; the restart already reloads it, this is the belt.
psql_dev "$DEV_DB" -q -c "NOTIFY pgrst, 'reload schema'" || true

# ---------------------------------------------------------------- migrations --
if [ "$RUN_MIGRATE" -eq 1 ]; then
  info "applying repository migrations"
  PW=$(container_env "$DEV_DB" POSTGRES_PASSWORD)
  NET=$(dev_network "$DEV_DB")
  [ -n "$PW" ] && [ -n "$NET" ] || die "could not read the dev password/network"
  docker build -q -f Dockerfile.migrate -t cash-flow-migrate:dev . >/dev/null
  docker run --rm --network "$NET" \
    -e DATABASE_URL="postgresql://supabase_admin:${PW}@db:5432/postgres" \
    cash-flow-migrate:dev
fi

# -------------------------------------------------------------------- report --
info "dev database now holds:"
psql_dev "$DEV_DB" -tAc "
  select 'auth.users            ' || count(*) from auth.users
  union all select 'transactions          ' || count(*) from public.transactions
  union all select 'pending_transactions  ' || count(*) from public.pending_transactions
  union all select 'schema_migrations     ' || count(*) from public.schema_migrations
  union all select 'active webhooks       ' || count(*) from public.webhooks where active
  union all select 'nextcloud w/ token    ' || count(*) from public.nextcloud_connections where access_token is not null;"
info "done"
