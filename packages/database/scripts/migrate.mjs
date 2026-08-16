import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL (or DATABASE_URL_UNPOOLED) is required to run migrations.");
  process.exit(1);
}

const migrationsFolder = path.join(pkgRoot, "migrations");
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Applied migrations from", migrationsFolder);
} finally {
  await client.end();
}
