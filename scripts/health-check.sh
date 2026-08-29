#!/usr/bin/env bash
# Verify ChatAI health endpoint. Exits non-zero on failure.
# Usage: HEALTH_URL=https://app.nightzeros.com/api/health ./scripts/health-check.sh
set -euo pipefail

HEALTH_URL="${HEALTH_URL:-https://app.nightzeros.com/api/health}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-30}"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"

health_curl() {
  local url="$1"
  shift
  curl --fail --silent --show-error --max-time 10 "$@" "$url"
}

validate_response() {
  local response="$1"
  if echo "$response" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "[health] OK: $response"
    return 0
  fi
  echo "[health] Unexpected response: $response" >&2
  return 1
}

try_health_url() {
  local url="$1"
  shift
  local response
  response="$(health_curl "$url" "$@")"
  validate_response "$response"
}

echo "[health] Checking ${HEALTH_URL}…"

# Extract host/path for local fallback (VPS DNS may not resolve public hostnames).
health_host=""
health_path="/api/health"
if [[ "$HEALTH_URL" =~ ^https?://([^/]+)(/.*)?$ ]]; then
  health_host="${BASH_REMATCH[1]}"
  health_path="${BASH_REMATCH[2]:-/api/health}"
fi

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if response="$(health_curl "$HEALTH_URL" 2>&1)" && validate_response "$response"; then
    exit 0
  fi

  # Bypass public DNS: hit local Caddy with the same Host header / SNI.
  if [[ -n "$health_host" ]]; then
    if response="$(health_curl "https://${health_host}${health_path}" \
      --resolve "${health_host}:443:127.0.0.1" 2>&1)" && validate_response "$response"; then
      echo "[health] OK via local Caddy (--resolve ${health_host}:443:127.0.0.1)"
      exit 0
    fi
    if response="$(health_curl "http://127.0.0.1${health_path}" \
      -H "Host: ${health_host}" 2>&1)" && validate_response "$response"; then
      echo "[health] OK via local Caddy (Host: ${health_host})"
      exit 0
    fi
  fi

  if [[ "$attempt" -eq "$MAX_ATTEMPTS" ]]; then
    echo "[health] Failed after ${MAX_ATTEMPTS} attempts." >&2
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
done
