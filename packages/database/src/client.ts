import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client.
 * Use the pooled Neon URL (`DATABASE_URL` with `-pooler`) for the app runtime.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, {
    max: options?.max ?? 10,
    prepare: false, // required for Neon pooled / PgBouncer transaction mode
  });

  return drizzle(client, { schema });
}

let cached: Database | null = null;

/**
 * Lazy singleton for the app. Reads `DATABASE_URL` on first use.
 */
export function getDb(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!cached) {
    cached = createDb(connectionString);
  }

  return cached;
}
