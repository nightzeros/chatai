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

  /** Optional Resend API key for password-reset (and future) transactional email */
  RESEND_API_KEY: z.string().optional(),
  /** From address for Resend (e.g. ChatAI <noreply@yourdomain.com>) */
  EMAIL_FROM: z.string().optional(),

  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_RESOURCE: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().optional(),

  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  VOYAGE_API_KEY: z.string().optional(),

  /** Optional Cohere API key for reranking (falls back to LLM listwise rerank). */
  COHERE_API_KEY: z.string().optional(),

  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  /** AES-256-GCM key for per-assistant provider secrets (32 bytes as base64 or hex). */
  ENCRYPTION_KEY: z.string().optional(),
  /** Version label written into new ciphertext envelopes (default 1). Bump when rotating. */
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().optional(),
  /** Prior key retained only for decrypt during rotation. */
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  ENCRYPTION_KEY_PREVIOUS_VERSION: z.coerce.number().int().positive().optional(),

  WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: z.coerce.number().int().positive().default(20),
  WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  WIDGET_SIGNING_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * Fallback monthly hosted AI provider-cost ceiling in micro-dollars ($1 = 1_000_000).
   * Prefer `plan_entitlements.monthly_limit_micros` / account override when present.
   */
  HOSTED_USAGE_DEFAULT_LIMIT_MICROS: z.coerce.number().int().nonnegative().default(5_000_000),

  /**
   * Usage metering mode:
   * - shadow: write usage_events, do not block requests (Phase 1 default)
   * - enforce: hard limits via atomic reservation (Task 6+)
   * - off: disable metering writes (self-host opt-out)
   */
  HOSTED_USAGE_ENFORCEMENT: z.enum(["shadow", "enforce", "off"]).default("shadow"),

  /** Conservative max completion tokens used when estimating chat reservation cost. */
  HOSTED_USAGE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),

  /** Abandoned reservation cleanup window. */
  HOSTED_USAGE_RECONCILE_STALE_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * When true, playground chat skips hard-limit reservation (still meters in shadow/enforce).
   * Intended for NightZeros internal debugging only.
   */
  HOSTED_USAGE_EXEMPT_PLAYGROUND: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Comma-separated Better Auth user IDs allowed to call /api/admin/* hosting controls.
   * Empty = no admins (all admin routes return 403).
   */
  ADMIN_USER_IDS: z.string().default(""),

  UPLOAD_DIR: z.string().default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Next.js webpack inlines `process.env.FOO` but not the whole `process.env` object.
  // Passing process.env into Zod drops CI/runtime secrets during `next build`.
  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_RESOURCE: process.env.AZURE_OPENAI_RESOURCE,
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: process.env.EMBEDDING_DIMENSIONS,
    VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
    COHERE_API_KEY: process.env.COHERE_API_KEY,
    API_RATE_LIMIT_PER_MINUTE: process.env.API_RATE_LIMIT_PER_MINUTE,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_KEY_VERSION: process.env.ENCRYPTION_KEY_VERSION,
    ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS,
    ENCRYPTION_KEY_PREVIOUS_VERSION: process.env.ENCRYPTION_KEY_PREVIOUS_VERSION,
    WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: process.env.WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE,
    WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE:
      process.env.WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE,
    WIDGET_SIGNING_MAX_SKEW_SECONDS: process.env.WIDGET_SIGNING_MAX_SKEW_SECONDS,
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: process.env.HOSTED_USAGE_DEFAULT_LIMIT_MICROS,
    HOSTED_USAGE_ENFORCEMENT: process.env.HOSTED_USAGE_ENFORCEMENT,
    HOSTED_USAGE_MAX_OUTPUT_TOKENS: process.env.HOSTED_USAGE_MAX_OUTPUT_TOKENS,
    HOSTED_USAGE_RECONCILE_STALE_MINUTES: process.env.HOSTED_USAGE_RECONCILE_STALE_MINUTES,
    HOSTED_USAGE_EXEMPT_PLAYGROUND: process.env.HOSTED_USAGE_EXEMPT_PLAYGROUND,
    ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
  });

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
