import { getDb, type Database } from "@chatai/database";

import { env } from "@/lib/env";

export function db(): Database {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  return getDb(env.DATABASE_URL);
}
