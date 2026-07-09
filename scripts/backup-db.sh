#!/usr/bin/env bash
# Daily Postgres backup for the single-server production deploy.
# Dumps the database from the running container to a compressed file and prunes
# backups older than the retention window. Intended to be run from cron.
#
#   0 18 * * *  /opt/CM-Pharmacy-API/scripts/backup-db.sh >> /var/log/cm-backup.log 2>&1
set -euo pipefail

APP_DIR="/opt/CM-Pharmacy-API"
COMPOSE="docker compose -f ${APP_DIR}/docker-compose.prod.yml"
BACKUP_DIR="/opt/backups"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

# Load POSTGRES_USER / POSTGRES_DB from the server .env.
set -a
. "${APP_DIR}/.env"
set +a

STAMP=$(date +%Y%m%d_%H%M%S)
FILE="${BACKUP_DIR}/cm_pharmacy_${STAMP}.sql.gz"

# pg_dump inside the db container; stream straight to a gzip file on the host.
$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$FILE"

echo "$(date -Is) backup written: ${FILE} ($(du -h "$FILE" | cut -f1))"

# Retention: delete dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -name 'cm_pharmacy_*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete
