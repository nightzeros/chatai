#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL is required."
  exit 1
fi

if ! psql "$DATABASE_URL" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'assistants'" | grep -q 1; then
  echo "[entrypoint] Applying initial database schema…"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/packages/database/migrations/0000_smart_iceman.sql
  echo "[entrypoint] Schema applied."
else
  echo "[entrypoint] Database schema already present."
fi

echo "[entrypoint] Starting ChatAI…"
exec node apps/web/server.js
