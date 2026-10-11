import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Pool settings for long-running servers. Without them a connection the pooler or a
 * NAT dropped while idle is reused and every query on it waits out the 30 s default
 * connect timeout (`ECONNRESET` / `CONNECT_TIMEOUT`).
 */
export const DATABASE_POOL_OPTIONS = {
  max: 10,
  /** Close connections idle this long (s), before an upstream idle cut can break them. */
  idle_timeout: 20,
  /** Recycle every connection after this long (s). */
  max_lifetime: 60 * 30,
  /** Fail a request fast when the database is unreachable (s). */
  connect_timeout: 10,
  prepare: false, // required for Neon pooled / PgBouncer transaction mode
} as const;

/**
 * Create a Drizzle client.
 * Use the pooled Neon URL (`DATABASE_URL` with `-pooler`) for the app runtime.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const client = postgres(connectionString, {
    ...DATABASE_POOL_OPTIONS,
    max: options?.max ?? DATABASE_POOL_OPTIONS.max,
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
