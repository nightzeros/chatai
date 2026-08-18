import { customType } from "drizzle-orm/pg-core";

/** Postgres full-text search vector type. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
