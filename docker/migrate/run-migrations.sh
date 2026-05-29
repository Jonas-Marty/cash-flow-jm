#!/bin/sh
set -e

# Migration runner for self-hosted Supabase
# Applies all SQL files from /migrations in timestamp order,
# skipping any that have already been applied.

: "${DATABASE_URL:?DATABASE_URL is required}"

echo "==> Waiting for database to be ready..."
RETRIES=30
until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  RETRIES=$((RETRIES - 1))
  echo "    Waiting for DB... ($RETRIES attempts left)"
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo "ERROR: Database not reachable after 60s"
  exit 1
fi

echo "==> Database is ready."

# Create tracking table if it doesn't exist
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# Apply migrations in order
APPLIED=0
SKIPPED=0

for f in /migrations/*.sql; do
  [ -f "$f" ] || continue
  VERSION=$(basename "$f")

  # Check if already applied
  EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM public.schema_migrations WHERE version = '$VERSION'" 2>/dev/null)
  if [ "$EXISTS" = "1" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "    Applying: $VERSION"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO public.schema_migrations (version) VALUES ('$VERSION')"
  APPLIED=$((APPLIED + 1))
done

echo "==> Migrations complete: $APPLIED applied, $SKIPPED already up-to-date."
