/* global console, process, URL */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.join(pkgRoot, "../..");
loadDotenv({ path: path.join(rootDir, ".env") });

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is required to run migrations.");
  console.error("Copy .env.example to the repo root .env, or export the variable in your shell.");
  process.exit(1);
}

// Mirrors src/connection-check.ts (this script runs as plain Node without TS).
function neonEndpoint(value) {
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".neon.tech") ? host.split(".")[0].replace(/-pooler$/, "") : null;
  } catch {
    return null;
  }
}
const pooledEndpoint = process.env.DATABASE_URL ? neonEndpoint(process.env.DATABASE_URL) : null;
const directEndpoint = process.env.DATABASE_URL_UNPOOLED
  ? neonEndpoint(process.env.DATABASE_URL_UNPOOLED)
  : null;
if (
  pooledEndpoint &&
  directEndpoint &&
  pooledEndpoint !== directEndpoint &&
  process.env.ALLOW_DATABASE_URL_MISMATCH !== "1"
) {
  console.error(
    `DATABASE_URL targets Neon endpoint ${pooledEndpoint} but DATABASE_URL_UNPOOLED targets ${directEndpoint}.`,
  );
  console.error(
    'Migrations would run against a different branch than the app. Use the direct URL of the same endpoint (host without "-pooler"), or set ALLOW_DATABASE_URL_MISMATCH=1.',
  );
  process.exit(1);
}

const migrationsFolder = path.join(pkgRoot, "migrations");
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

/**
 * Old Docker entrypoint applied only 0000 via psql (no drizzle journal).
 * Stamp that migration so `migrate()` can apply 0001+ without re-running 0000.
 */
async function baselineLegacyDockerBootstrap() {
  const assistants = await client`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'assistants'
    LIMIT 1
  `;
  if (assistants.length === 0) return;

  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const existing = await client`SELECT id FROM drizzle.__drizzle_migrations LIMIT 1`;
  if (existing.length > 0) return;

  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const first = journal.entries?.[0];
  if (!first?.tag || first.when == null) {
    throw new Error("[migrate] Cannot baseline legacy install: journal entry 0 is missing");
  }

  const sqlPath = path.join(migrationsFolder, `${first.tag}.sql`);
  const query = fs.readFileSync(sqlPath, "utf8");
  const hash = crypto.createHash("sha256").update(query).digest("hex");

  await client`
    INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
    VALUES (${hash}, ${first.when})
  `;
  console.log(`[migrate] Baselined legacy Docker bootstrap as ${first.tag}`);
}

try {
  await baselineLegacyDockerBootstrap();
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Applied migrations from", migrationsFolder);
} finally {
  await client.end();
}
