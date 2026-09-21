#!/usr/bin/env bash
# Run the end-to-end suite inside the toolbox (the host has no browser).
#
#   scripts/dev/e2e.sh                          # whole suite
#   scripts/dev/e2e.sh --grep "fill-right"      # one test
#
# The suite talks to a Supabase host that cannot resolve: every call is intercepted
# by tests/e2e/support/stub.ts, so this touches no database and needs no credentials.
#
# The dev server is started here rather than by Playwright's `webServer`, whose
# readiness probe never settles against it in this container even though curl gets
# an immediate 200.
set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/tools.sh" bash -c '
set -euo pipefail
bunx vite dev --mode e2e --port 5199 --strictPort --host 127.0.0.1 >/tmp/e2e-vite.log 2>&1 &
vite_pid=$!
trap "kill $vite_pid 2>/dev/null || true" EXIT

for i in $(seq 1 120); do
  curl -sf -o /dev/null http://127.0.0.1:5199/ && break
  kill -0 $vite_pid 2>/dev/null || { echo "vite died:"; tail -20 /tmp/e2e-vite.log; exit 1; }
  sleep 1
done
curl -sf -o /dev/null http://127.0.0.1:5199/ || { echo "vite never became ready:"; tail -20 /tmp/e2e-vite.log; exit 1; }

npx playwright test --config tests/e2e/playwright.config.ts "$@"
' -- "$@"
