#!/usr/bin/env bash
# Backup or restore the ChatAI uploads Docker volume.
#
# Backup:
#   ./scripts/backup-uploads.sh
#   BACKUP_DIR=/opt/chatai/backups ./scripts/backup-uploads.sh
#
# Restore (maintenance window):
#   ./scripts/backup-uploads.sh restore backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
VOLUME_NAME="${VOLUME_NAME:-chatai_chatai_uploads}"

cmd_backup() {
  cd "$DEPLOY_DIR"
  mkdir -p "$BACKUP_DIR"

  local timestamp archive_name archive_path file_count byte_size
  timestamp="$(date -u +"%Y%m%d-%H%M%S")"
  archive_name="chatai-uploads-${timestamp}.tgz"
  archive_path="${BACKUP_DIR}/${archive_name}"

  if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "[backup] Volume ${VOLUME_NAME} not found. Is the stack running?" >&2
    echo "[backup] List volumes: docker volume ls" >&2
    exit 1
  fi

  echo "[backup] Archiving volume ${VOLUME_NAME} → ${archive_path}…"

  docker run --rm \
    -v "${VOLUME_NAME}:/data:ro" \
    -v "${BACKUP_DIR}:/backup" \
    alpine:3.20 \
    tar czf "/backup/${archive_name}" -C /data .

  sha256sum "$archive_path" >"${archive_path}.sha256"

  file_count="$(docker run --rm \
    -v "${VOLUME_NAME}:/data:ro" \
    alpine:3.20 \
    sh -c 'find /data -type f 2>/dev/null | wc -l | tr -d " "')"

  byte_size="$(wc -c <"$archive_path" | tr -d ' ')"

  echo "[backup] Done."
  echo "[backup] Archive: ${archive_path}"
  echo "[backup] Checksum: ${archive_path}.sha256"
  echo "[backup] Files in volume: ${file_count}"
  echo "[backup] Archive size (bytes): ${byte_size}"
  echo "[backup] Verify with: ./scripts/verify-uploads-backup.sh ${archive_path}"
}

cmd_restore() {
  local archive="$1"
  cd "$DEPLOY_DIR"

  if [[ ! -f "$archive" ]]; then
    echo "[restore] Archive not found: $archive" >&2
    exit 1
  fi

  echo "[restore] Verifying backup before restore…"
  "$SCRIPT_DIR/verify-uploads-backup.sh" "$archive"

  if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "[restore] Volume ${VOLUME_NAME} not found. Start stack once to create it:" >&2
    echo "  docker compose -f $COMPOSE_FILE up -d" >&2
    exit 1
  fi

  echo "[restore] Stopping ChatAI…"
  docker compose -f "$COMPOSE_FILE" stop chatai

  echo "[restore] Restoring volume ${VOLUME_NAME}…"
  docker run --rm \
    -v "${VOLUME_NAME}:/data" \
    -v "$(realpath "$archive"):/backup.tgz:ro" \
    alpine:3.20 \
    sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true; tar xzf /backup.tgz -C /data'

  echo "[restore] Starting ChatAI…"
  docker compose -f "$COMPOSE_FILE" up -d chatai

  if ! HEALTH_URL="${HEALTH_URL:-https://app.nightzeros.com/api/health}" \
    "$SCRIPT_DIR/health-check.sh"; then
    echo "[restore] Health check failed after restore." >&2
    exit 1
  fi

  echo "[restore] Success. Uploads restored from ${archive}"
}

case "${1:-backup}" in
  backup)
    cmd_backup
    ;;
  restore)
    cmd_restore "${2:?Usage: $0 restore <path-to-backup.tgz>}"
    ;;
  *)
    echo "Usage: $0 [backup|restore <archive>]" >&2
    exit 1
    ;;
esac
