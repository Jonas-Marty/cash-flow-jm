#!/usr/bin/env bash
# Shared helpers for the dev-environment scripts.
#
# Containers are found by compose labels rather than by name: Dokploy prefixes
# every project with a generated suffix (cash-flow-dev-supabase-ab12cd), so the
# names are not knowable ahead of time.

PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-cash-flow-supabase-e2meaa-supabase-db}"
PROD_STORAGE_DIR="${PROD_STORAGE_DIR:-/etc/dokploy/compose/cash-flow-supabase-e2meaa/files/volumes/storage}"

die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$*" >&2; }

# find_container <compose-project> <service> -> container id (may be empty)
find_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2" | head -1
}

# detect_dev_project -> the compose project of the dev Supabase stack.
# Override with DEV_PROJECT=... when several match.
detect_dev_project() {
  if [ -n "${DEV_PROJECT:-}" ]; then printf '%s\n' "$DEV_PROJECT"; return; fi
  local found
  found=$(docker ps --format '{{.Label "com.docker.compose.project"}}' \
    | grep -E 'dev.*supabase|supabase.*dev' | sort -u)
  [ -n "$found" ] || die "no running dev Supabase stack found; pass DEV_PROJECT=<compose project>"
  [ "$(printf '%s\n' "$found" | wc -l)" -eq 1 ] \
    || die "several candidates, pass DEV_PROJECT=<one of>:"$'\n'"$found"
  printf '%s\n' "$found"
}

# Refuse to touch anything that is not clearly the dev stack.
assert_is_dev_project() {
  local project="$1"
  case "$project" in
    *dev*) ;;
    *) die "refusing to operate on compose project '$project': the name does not contain 'dev'" ;;
  esac
  local prod_project
  prod_project=$(docker inspect "$PROD_DB_CONTAINER" \
    --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
  [ -n "$prod_project" ] && [ "$project" = "$prod_project" ] \
    && die "refusing: '$project' is the production Supabase project"
  return 0
}

# container_env <container> <VAR> -> value of an env var set on the container
container_env() {
  docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | sed -n "s/^$2=//p" | head -1
}

# dev_network <db container> -> the docker network the stack shares
dev_network() {
  docker inspect "$1" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' \
    | grep -v '^bridge$' | head -1
}

# psql_dev <db container> [args...] -> psql as the superuser of the dev db
psql_dev() {
  local c="$1"; shift
  docker exec -i "$c" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}
