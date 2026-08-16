import { getDb } from "@chatai/database";
import * as schema from "@chatai/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { env } from "@/lib/env";

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required. Set it in the monorepo root .env file.`);
  }
  return value;
}

const baseURL = requireEnv(env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
const secret = requireEnv(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET");
const githubEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

export const auth = betterAuth({
  baseURL,
  secret,
  trustedOrigins: [baseURL, "http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"],
  database: drizzleAdapter(getDb(requireEnv(env.DATABASE_URL, "DATABASE_URL")), {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  ...(githubEnabled
    ? {
        socialProviders: {
          github: {
            clientId: env.GITHUB_CLIENT_ID!,
            clientSecret: env.GITHUB_CLIENT_SECRET!,
          },
        },
      }
    : {}),
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
