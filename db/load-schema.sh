#!/usr/bin/env bash
# Load the full schema into ANY Postgres via psql over a connection string.
# Works for local Docker (DATABASE_URL=...localhost:5544...) or AWS RDS.
# Unlike db/bootstrap.sh (which uses `docker exec`), this only needs a psql
# client and network access to the target DB.
#
#   DATABASE_URL="postgres://user:pass@host:5432/cm_pharmacy" bash db/load-schema.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the target Postgres connection string}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Applying migrations..."
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "Applying RPC functions..."
for f in "$ROOT"/db/functions/*.sql; do
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "Done. Tables:"
psql "$DATABASE_URL" -c "\dt"
