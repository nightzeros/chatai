#!/usr/bin/env bash
# Run docker compose against production with the deployed image tag.
# docker-compose.prod.yml requires CHATAI_IMAGE_TAG; this reads current_tag from
# .deploy-state (written by deploy.sh / rollback.sh) so plain commands just work.
#
# Usage (on the VPS):
#   ./scripts/compose.sh logs -f chatai
#   ./scripts/compose.sh ps
#   ./scripts/compose.sh up -d chatai     # e.g. after editing .env.production
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STATE_FILE="${STATE_FILE:-.deploy-state}"

cd "$DEPLOY_DIR"

if [[ -z "${CHATAI_IMAGE_TAG:-}" ]]; then
  current_tag=""
  if [[ -f "$STATE_FILE" ]]; then
    current_tag="$(sed -n 's/^current_tag=//p' "$STATE_FILE" | tail -n 1)"
  fi
  if [[ -z "$current_tag" ]]; then
    echo "[compose] No current_tag in $DEPLOY_DIR/$STATE_FILE. Deploy first, or set CHATAI_IMAGE_TAG." >&2
    exit 1
  fi
  export CHATAI_IMAGE_TAG="$current_tag"
fi

exec docker compose -f "$COMPOSE_FILE" "$@"
