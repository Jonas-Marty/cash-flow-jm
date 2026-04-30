#!/bin/bash
# Run on first DB init only. Applies every .sql file in
# /docker-entrypoint-initdb.d/migrations in alphabetical (timestamp) order.
# Runs AFTER Supabase's own bootstrap scripts have created auth/storage/etc.
set -euo pipefail

MIG_DIR="/docker-entrypoint-initdb.d/migrations"
if [ ! -d "$MIG_DIR" ]; then
  echo "[app-migrations] no migrations directory at $MIG_DIR — skipping"
  exit 0
fi

echo "[app-migrations] applying migrations from $MIG_DIR"
# shellcheck disable=SC2012
for f in $(ls -1 "$MIG_DIR"/*.sql 2>/dev/null | sort); do
  echo "[app-migrations] -> $(basename "$f")"
  psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-postgres}" -f "$f"
done
echo "[app-migrations] done."