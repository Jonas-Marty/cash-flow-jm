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

# Dev's own Nextcloud login: the app login registered for the dev callback URL
# (its own client id and secret in Nextcloud) and the tokens it earned. A clone
# replaces the row with production's, and the scrub then blanks production's
# secret and tokens, so without this every clone meant setting dev up again.
#
# Only rows with a non-empty client_secret are kept: the scrub blanks every
# secret it copies from production, so a non-empty one was entered on dev.
# Production's own tokens are never carried: they are not in the dev database
# to begin with, and carrying them would let dev redeem prod's refresh token,
# which Nextcloud rotates, and log production out.
NC_KEEP_COLS="user_id, base_url, client_id, client_secret, access_token, refresh_token, token_expires_at, scope, nextcloud_user"

# nc_keep_save <db container> <file> -> CSV of dev's own Nextcloud rows
nc_keep_save() {
  # A freshly reset dev database has no app tables yet: nothing to keep.
  if [ "$(psql_dev "$1" -Atc "SELECT to_regclass('public.nextcloud_connections') IS NOT NULL")" != "t" ]; then
    : > "$2"; return 0
  fi
  ( umask 077
    psql_dev "$1" -c "COPY (SELECT $NC_KEEP_COLS FROM public.nextcloud_connections WHERE client_secret <> '') TO STDOUT WITH CSV" > "$2" )
}

# oidc_keep_save <db container> <file> -> dev's own sign-in providers from the
# auth service (e.g. its Authentik client), one base64 JSON row per line, so the
# clone can put them back: the restore brings production's, which scrub drops.
oidc_keep_save() {
  if [ "$(psql_dev "$1" -Atc "SELECT to_regclass('auth.custom_oauth_providers') IS NOT NULL")" != "t" ]; then
    : > "$2"; return 0
  fi
  ( umask 077
    psql_dev "$1" -Atc "SELECT translate(encode(convert_to(row_to_json(p)::text, 'UTF8'), 'base64'), E'\\n', '') FROM auth.custom_oauth_providers p" > "$2" )
}

# oidc_keep_restore <db container> <file> -> put them back, in one transaction.
oidc_keep_restore() {
  [ -s "$2" ] || return 0
  {
    echo "BEGIN;"
    while IFS= read -r row; do
      [ -n "$row" ] || continue
      # base64 has no quote characters, so it is safe inline.
      echo "INSERT INTO auth.custom_oauth_providers SELECT * FROM json_populate_record(NULL::auth.custom_oauth_providers, convert_from(decode('$row', 'base64'), 'UTF8')::json) ON CONFLICT (identifier) DO NOTHING;"
    done < "$2"
    echo "COMMIT;"
  } | psql_dev "$1" -q
}

# nc_keep_restore <db container> <file> -> put those rows back over the clone.
# Users missing from the clone are skipped; everything is one transaction.
nc_keep_restore() {
  [ -s "$2" ] || return 0
  {
    printf '%s\n' "BEGIN;" \
      "CREATE TEMP TABLE nc_keep (user_id uuid, base_url text, client_id text, client_secret text, access_token text, refresh_token text, token_expires_at timestamptz, scope text, nextcloud_user text) ON COMMIT DROP;" \
      "COPY nc_keep FROM STDIN WITH CSV;"
    cat "$2"
    printf '%s\n' '\.' \
      "INSERT INTO public.nextcloud_connections ($NC_KEEP_COLS)
         SELECT k.* FROM nc_keep k WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = k.user_id)
       ON CONFLICT (user_id) DO UPDATE SET
         base_url = EXCLUDED.base_url, client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret,
         access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope,
         nextcloud_user = EXCLUDED.nextcloud_user;" \
      "COMMIT;"
  } | psql_dev "$1" -q
}
