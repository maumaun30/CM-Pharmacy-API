#!/usr/bin/env bash
# Load the full schema into the local Docker Postgres.
# Applies every supabase/migrations/*.sql in filename order (they are
# timestamp-prefixed, so lexical order == chronological order), then the
# create_sale RPC. Idempotent-ish: safe to re-run after a `db:reset`.
set -euo pipefail

CONTAINER="cm-pharmacy-db"
DB_USER="cmpharmacy"
DB_NAME="cm_pharmacy"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Waiting for Postgres to be ready..."
until docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 1
done

apply() {
  echo "  → applying $(basename "$1")"
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$1"
}

echo "Applying migrations..."
for f in "$ROOT"/supabase/migrations/*.sql; do
  apply "$f"
done

echo "Applying RPC functions..."
for f in "$ROOT"/db/functions/*.sql; do
  apply "$f"
done

echo "Done. Tables:"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "\dt"
