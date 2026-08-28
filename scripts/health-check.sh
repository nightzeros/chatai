#!/usr/bin/env bash
# Verify ChatAI health endpoint. Exits non-zero on failure.
# Usage: HEALTH_URL=https://app.nightzeros.com/api/health ./scripts/health-check.sh
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://app.nightzeros.com/api/health}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

echo "[health] Checking ${HEALTH_URL}…"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if response="$(curl --fail --silent --show-error --max-time 10 "$HEALTH_URL" 2>&1)"; then
    if echo "$response" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      echo "[health] OK: $response"
      exit 0
    fi
    echo "[health] Unexpected response: $response" >&2
    exit 1
  fi
  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "[health] Failed after ${MAX_ATTEMPTS} attempts." >&2
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
done
