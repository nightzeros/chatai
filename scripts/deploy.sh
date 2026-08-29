#!/usr/bin/env bash
# Deploy an immutable GHCR image tag to production.
# Usage: CHATAI_IMAGE_TAG=v1.0.0 ./scripts/deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STATE_FILE="${STATE_FILE:-.deploy-state}"
IMAGE_TAG="${CHATAI_IMAGE_TAG:?CHATAI_IMAGE_TAG is required (immutable GHCR tag, e.g. v1.0.0)}"

cd "$DEPLOY_DIR"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "[deploy] Missing $COMPOSE_FILE in $DEPLOY_DIR" >&2
  exit 1
fi

if [[ ! -f .env.production ]]; then
  echo "[deploy] Missing .env.production in $DEPLOY_DIR" >&2
  exit 1
fi

previous_tag=""
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE" 2>/dev/null || true
  previous_tag="${current_tag:-}"
fi

echo "[deploy] Target image: ghcr.io/master-tecs/chatai:${IMAGE_TAG}"
if [[ -n "$previous_tag" ]]; then
  echo "[deploy] Previous image: ghcr.io/master-tecs/chatai:${previous_tag}"
fi

export CHATAI_IMAGE_TAG="$IMAGE_TAG"

echo "[deploy] Pulling image…"
docker compose -f "$COMPOSE_FILE" pull chatai

echo "[deploy] Running migrations once (before switching app)…"
if ! docker compose -f "$COMPOSE_FILE" run --rm --no-deps --entrypoint node chatai \
  /app/packages/database/scripts/migrate.mjs; then
  echo "[deploy] Migration failed. App was not restarted." >&2
  echo "[deploy] The running container (if any) remains on the previous image." >&2
  if [[ -n "$previous_tag" ]]; then
    echo "[deploy] No rollback needed — app was not switched." >&2
  fi
  exit 1
fi

echo "[deploy] Starting services…"
docker compose -f "$COMPOSE_FILE" up -d

echo "[deploy] Running health check…"
if ! HEALTH_URL="${HEALTH_URL:-https://app.nightzeros.com/api/health}" \
  "$SCRIPT_DIR/health-check.sh"; then
  echo "[deploy] Health check failed after deploy." >&2
  echo "[deploy] Manual rollback required (v1 — no automatic rollback):" >&2
  if [[ -n "$previous_tag" ]]; then
    echo "  cd $DEPLOY_DIR && CHATAI_IMAGE_TAG=${previous_tag} ./scripts/rollback.sh" >&2
  else
    echo "  Investigate logs: docker compose -f $COMPOSE_FILE logs chatai" >&2
  fi
  echo "[deploy] Migration compatibility: if migrations applied successfully but the new" >&2
  echo "  app is unhealthy, rolling back the app may still leave the DB on a newer schema." >&2
  echo "  See docs/deployment/vps.md before running rollback.sh." >&2
  exit 1
fi

deployed_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat >"$STATE_FILE" <<EOF
current_tag=${IMAGE_TAG}
previous_tag=${previous_tag}
deployed_at=${deployed_at}
EOF

echo "[deploy] Success. Deployed ghcr.io/master-tecs/chatai:${IMAGE_TAG} at ${deployed_at}"
