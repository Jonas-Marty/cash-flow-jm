#!/usr/bin/env bash
# Throw the dev Supabase stack away, volumes and all.
#
# The point of the dev environment is that this is cheap: redeploy in Dokploy
# afterwards and re-run scripts/dev/clone-prod-db.sh.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# shellcheck source=scripts/dev/lib.sh
source scripts/dev/lib.sh

ASSUME_YES=0
[ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && ASSUME_YES=1

DEV_PROJECT_NAME=$(detect_dev_project)
assert_is_dev_project "$DEV_PROJECT_NAME"

info "about to destroy compose project '$DEV_PROJECT_NAME' including its volumes"
if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Type the project name to confirm: " reply
  [ "$reply" = "$DEV_PROJECT_NAME" ] || die "aborted"
fi

docker compose -p "$DEV_PROJECT_NAME" down -v --remove-orphans
info "gone. Redeploy 'cash-flow-dev-supabase' in Dokploy, then re-run scripts/dev/clone-prod-db.sh"
