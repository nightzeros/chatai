#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is required."
  exit 1
fi

echo "[entrypoint] Applying database migrations…"
node /app/packages/database/scripts/migrate.mjs

echo "[entrypoint] Starting ChatAI…"
exec node apps/web/server.js
