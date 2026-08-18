import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

function loadRootEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "../../.env"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false });
      return;
    }
  }
}

loadRootEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Pooled Neon URL or local Postgres */
  DATABASE_URL: z.string().min(1).optional(),
  /** Direct (non-pooler) Neon URL — used for migrations */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_MODEL: z.string().default("gpt-4o-mini"),

  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  /** Optional Cohere API key for reranking (falls back to LLM listwise rerank). */
  COHERE_API_KEY: z.string().optional(),

  UPLOAD_DIR: z.string().default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables. Check .env against .env.example.");
  }

  return parsed.data;
}

/**
 * Validated environment. Import only from server code.
 * DATABASE_URL and BETTER_AUTH_SECRET are required at runtime for auth (Task 3+).
 */
export const env = loadEnv();
