import { getDb } from "@chatai/database";
import * as schema from "@chatai/database/schema";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { brand } from "@/lib/site";

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
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const footerText = `\n\n—\nChatAI by ${brand.company.name}\n${brand.company.url}`;
      const footerHtml = `<p style="margin-top:1.5rem;font-size:12px;color:#666">ChatAI by <a href="${brand.company.url}">${brand.company.name}</a></p>`;
      await sendEmail({
        to: user.email,
        subject: "Reset your ChatAI password",
        text: `Reset your password (link expires in 1 hour):\n\n${url}${footerText}`,
        html: `<p>Reset your password (expires in 1 hour):</p><p><a href="${url}">${url}</a></p>${footerHtml}`,
      });
      await logAuditEvent({
        userId: user.id,
        action: "password_reset_requested",
        resourceType: "user",
        resourceId: user.id,
      });
    },
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
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await logAuditEvent({
            userId: session.userId,
            action: "login",
            resourceType: "session",
            resourceId: session.id,
          });
        },
      },
      delete: {
        after: async (session) => {
          await logAuditEvent({
            userId: session.userId,
            action: "logout",
            resourceType: "session",
            resourceId: session.id,
          });
        },
      },
    },
    user: {
      delete: {
        before: async (user) => {
          await logAuditEvent({
            userId: user.id,
            action: "account_deleted",
            resourceType: "user",
            resourceId: user.id,
          });
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const path = ctx.path ?? "";
      if (path === "/reset-password" || path.endsWith("/reset-password")) {
        const userId =
          (ctx.context.session?.user?.id as string | undefined) ??
          (typeof ctx.body === "object" &&
          ctx.body &&
          "userId" in ctx.body &&
          typeof (ctx.body as { userId?: unknown }).userId === "string"
            ? (ctx.body as { userId: string }).userId
            : null);
        await logAuditEvent({
          userId,
          action: "password_reset_completed",
          resourceType: "user",
          resourceId: userId,
        });
      }
    }),
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
