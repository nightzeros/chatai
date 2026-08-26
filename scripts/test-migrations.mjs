#!/usr/bin/env node
/**
 * Applies all Drizzle migrations on the configured database.
 * Intended for CI against a fresh Postgres service.
 *
 *   DATABASE_URL=… pnpm test:migrations
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
  console.error("[test:migrations] DATABASE_URL (or DATABASE_URL_UNPOOLED) is required.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [path.join(root, "packages/database/scripts/migrate.mjs")],
  { cwd: root, stdio: "inherit", env: process.env },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("[test:migrations] All migrations applied successfully.");
