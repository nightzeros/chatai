import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: path.join(rootDir, ".env") });

/**
 * Prefer a direct (non-pooled) Neon URL for migrations.
 * Pooled endpoints can break DDL / long-running migrate sessions.
 */
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or DATABASE_URL_UNPOOLED) is required for drizzle-kit. Copy .env.example to .env.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
  strict: true,
  verbose: true,
});
