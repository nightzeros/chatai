import {
  assistants,
  count,
  eq,
  hostingAccounts,
  sql,
  type InferInsertModel,
} from "@chatai/database";

import { db } from "@/lib/db";

import type { HostingAccount } from "./accounts";
import { checkHostingAccountAccess } from "./accounts";
import { resolveAccountEntitlements } from "./plan-entitlements";

export type PlanLimitReachedError = {
  code: "PLAN_LIMIT_REACHED";
  resource: "assistants";
  current: number;
  limit: number;
  message: string;
};

export type AssistantInsertValues = InferInsertModel<typeof assistants>;

export function isPlanLimitReachedError(value: unknown): value is PlanLimitReachedError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as PlanLimitReachedError).code === "PLAN_LIMIT_REACHED"
  );
}

export function formatAssistantLimitMessage(limit: number): string {
  return `You've reached the ${limit}-assistant limit on your current plan. Upgrade to create more.`;
}

/**
 * Count assistants owned by a user (authoritative server-side count).
 */
export async function countAssistantsForUser(userId: string): Promise<number> {
  const [row] = await db()
    .select({ value: count() })
    .from(assistants)
    .where(eq(assistants.userId, userId));
  return Number(row?.value ?? 0);
}

/**
 * Create an assistant inside a transaction that locks the hosting account row,
 * so concurrent creates cannot exceed maxAssistants.
 */
export async function createAssistantWithLimit(input: {
  account: HostingAccount;
  userId: string;
  values: AssistantInsertValues;
}): Promise<
  | { ok: true; assistant: typeof assistants.$inferSelect }
  | { ok: false; error: PlanLimitReachedError }
> {
  const access = checkHostingAccountAccess(input.account);
  if (!access.ok) {
    return {
      ok: false,
      error: {
        code: "PLAN_LIMIT_REACHED",
        resource: "assistants",
        current: 0,
        limit: 0,
        message: access.error,
      },
    };
  }

  return db().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM hosting_accounts WHERE id = ${input.account.id} FOR UPDATE`,
    );

    const [accountRow] = await tx
      .select()
      .from(hostingAccounts)
      .where(eq(hostingAccounts.id, input.account.id))
      .limit(1);

    if (!accountRow) {
      return {
        ok: false,
        error: {
          code: "PLAN_LIMIT_REACHED",
          resource: "assistants",
          current: 0,
          limit: 0,
          message: "Hosting account not found.",
        },
      };
    }

    const entitlements = await resolveAccountEntitlements(accountRow);
    const [countRow] = await tx
      .select({ value: count() })
      .from(assistants)
      .where(eq(assistants.userId, input.userId));
    const current = Number(countRow?.value ?? 0);
    const limit = entitlements.maxAssistants;

    if (current >= limit) {
      return {
        ok: false,
        error: {
          code: "PLAN_LIMIT_REACHED",
          resource: "assistants",
          current,
          limit,
          message: formatAssistantLimitMessage(limit),
        },
      };
    }

    const [created] = await tx.insert(assistants).values(input.values).returning();
    if (!created) {
      throw new Error("Could not create assistant.");
    }
    return { ok: true, assistant: created };
  });
}
