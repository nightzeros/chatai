#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is required."
  exit 1
fi

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
  echo "[entrypoint] Applying database migrations…"
  node /app/packages/database/scripts/migrate.mjs
else
  echo "[entrypoint] RUN_MIGRATIONS=0 — skipping migrations (production deploy runs them separately)."
fi

echo "[entrypoint] Starting ChatAI…"
node apps/web/server.js &
app_pid=$!

cleanup() {
  if kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup INT TERM

echo "[entrypoint] Waiting for /api/health…"
ready=0
i=0
while [ "$i" -lt 60 ]; do
  if wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "[entrypoint] App process exited before becoming healthy."
    wait "$app_pid" || true
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "[entrypoint] Timed out waiting for /api/health."
  cleanup
  exit 1
fi

if [ "${SEED_DEMO_ON_START:-}" = "1" ]; then
  echo "[entrypoint] SEED_DEMO_ON_START=1 — seeding demo data (dev/demo only)…"
  # Prefer loopback so seed hits this container even when BETTER_AUTH_URL is a public hostname.
  SEED_AUTH_URL="http://127.0.0.1:3000"
  if ! BETTER_AUTH_URL="$SEED_AUTH_URL" \
    node /app/packages/database/scripts/seed-demo.mjs; then
    echo "[entrypoint] Demo seed failed (app stays up). Check logs / AI_API_KEY / auth URL."
  fi
fi

wait "$app_pid"
