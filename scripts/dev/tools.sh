#!/usr/bin/env bash
# Run a command inside the browser/bun toolbox with this repo mounted.
#
#   scripts/dev/tools.sh                     # interactive shell
#   scripts/dev/tools.sh bun run lint
#   scripts/dev/tools.sh node scripts/dev/screenshot.mjs --mobile --path /pending
#   scripts/dev/tools.sh --build             # force a rebuild of the image
#
# --network host so the container can reach a `bun run dev` on localhost:8080
# and anything else on this machine.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
IMAGE="${TOOLS_IMAGE:-cash-flow-tools:local}"

if [ "${1:-}" = "--build" ]; then
  shift
  docker build -t "$IMAGE" "$REPO/docker/tools"
elif ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf '\033[36m==>\033[0m building %s (first run, this pulls ~2 GB)\n' "$IMAGE"
  docker build -t "$IMAGE" "$REPO/docker/tools"
fi

tty_flags=()
[ -t 0 ] && tty_flags=(-it)

exec docker run --rm "${tty_flags[@]}" \
  --network host --ipc=host --init \
  -u "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$REPO":/work -w /work \
  -v cash-flow-tools-home:/tmp/.cache \
  -e DEV_APP_URL -e DEV_LOGIN_EMAIL -e DEV_LOGIN_PASSWORD \
  "$IMAGE" "${@:-bash}"
