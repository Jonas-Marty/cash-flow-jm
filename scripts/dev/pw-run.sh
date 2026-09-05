#!/usr/bin/env bash
# Run an arbitrary Playwright script inside the toolbox:
#   scripts/dev/pw-run.sh scripts/dev/screenshot.mjs --path /pending --mobile
set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/tools.sh" node "$@"
