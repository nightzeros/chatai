#!/usr/bin/env bash
# Manual application rollback to a previous immutable GHCR tag.
# Does NOT reverse database migrations — read docs/deployment/vps.md first.
#
# Usage:
#   CHATAI_IMAGE_TAG=v1.0.0 ./scripts/rollback.sh
#   ./scripts/rollback.sh   # uses previous_tag from .deploy-state
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STATE_FILE="${STATE_FILE:-.deploy-state}"

cd "$DEPLOY_DIR"

rollback_tag="${CHATAI_IMAGE_TAG:-}"
if [[ -z "$rollback_tag" && -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  rollback_tag="${previous_tag:-}"
fi

if [[ -z "$rollback_tag" ]]; then
  echo "[rollback] No rollback tag. Set CHATAI_IMAGE_TAG or ensure .deploy-state has previous_tag." >&2
  exit 1
fi

echo "[rollback] WARNING: Application rollback does not undo database migrations." >&2
echo "[rollback] If migrations ran on a newer version, the old app may fail against the current schema." >&2
echo "[rollback] Check Neon drizzle.__drizzle_migrations before proceeding." >&2
echo "[rollback] Press Ctrl+C within 5 seconds to abort…" >&2
sleep 5

export CHATAI_IMAGE_TAG="$rollback_tag"

echo "[rollback] Pulling ghcr.io/nightzeros/chatai:${rollback_tag}…"
docker compose -f "$COMPOSE_FILE" pull chatai

echo "[rollback] Restarting services (no migrations — RUN_MIGRATIONS=0)…"
docker compose -f "$COMPOSE_FILE" up -d

if ! HEALTH_URL="${HEALTH_URL:-https://app.nightzeros.com/api/health}" \
  "$SCRIPT_DIR/health-check.sh"; then
  echo "[rollback] Health check failed after rollback." >&2
  echo "[rollback] Database may be on a schema incompatible with this app version." >&2
  echo "[rollback] Consider Neon branch restore or forward-fix migration." >&2
  exit 1
fi

current_tag=""
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

deployed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat >"$STATE_FILE" <<EOF
current_tag=${rollback_tag}
previous_tag=${current_tag:-}
deployed_at=${deployed_at}
rolled_back_at=${deployed_at}
EOF

echo "[rollback] Success. Running ghcr.io/nightzeros/chatai:${rollback_tag}"
