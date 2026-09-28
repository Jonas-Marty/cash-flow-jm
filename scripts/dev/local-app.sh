#!/usr/bin/env bash
# Run this checkout's app locally (vite dev) against the DEV Supabase stack,
# so a change can be tried before it is pushed and deployed.
#
#   scripts/dev/local-app.sh                 # http://localhost:5180  (8080 is taken on this host)
#   PORT=5190 scripts/dev/local-app.sh
#
# Then sign in without a password and drive it from the toolbox:
#   node scripts/dev/dev-session.mjs --origin http://localhost:5180
#   scripts/dev/tools.sh node scripts/dev/screenshot.mjs --url http://localhost:5180 --path /settings
#
# Reads .env.dev-app (URL, publishable key) and .env.dev-supabase (service
# key, for server functions) and never prints them. Refuses a non-dev URL.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO"

val() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g'; }
URL=$(val .env.dev-app VITE_SUPABASE_URL)
PUB=$(val .env.dev-app VITE_SUPABASE_PUBLISHABLE_KEY)
SERVICE=$(val .env.dev-supabase SERVICE_ROLE_KEY)
case "$URL" in *dev*) ;; *) echo "refusing: $URL is not the dev stack" >&2; exit 1 ;; esac

export VITE_SUPABASE_URL="$URL" SUPABASE_URL="$URL"
export VITE_SUPABASE_PUBLISHABLE_KEY="$PUB" SUPABASE_PUBLISHABLE_KEY="$PUB"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE"
export VITE_HELP_URL="${VITE_HELP_URL:-https://help.cash-flow.wi-wo.ch}"
# The committed .env targets another project; these exports win over it.
exec npx vite dev --port "${PORT:-5180}" --strictPort --host 127.0.0.1
