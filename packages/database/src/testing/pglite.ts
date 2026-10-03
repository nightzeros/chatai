import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";

import type { Database } from "../client";
import * as schema from "../schema";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

/**
 * In-process Postgres (PGlite + pgvector) with every migration applied, for
 * tests that need real SQL semantics. Never used by the app runtime.
 */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { vector } });
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  };
  for (const entry of journal.entries) {
    const sql = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, close: () => client.close() };
}
