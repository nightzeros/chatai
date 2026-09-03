import {
  eq,
  hostingAccounts,
  type HostingAccountStatus,
  type HostingPlanCode,
} from "@chatai/database";

import { db } from "@/lib/db";
import { createId } from "@/lib/ids";

import { defaultPeriodAnchor } from "./period-anchor";

export type HostingAccount = typeof hostingAccounts.$inferSelect;

export const DEFAULT_HOSTING_PLAN_CODE: HostingPlanCode = "free";

export type HostingAccountAccessResult =
  | { ok: true }
  | { ok: false; status: 403; error: string; reason: "account_suspended" | "account_disabled" };

export function isHostingAccountActive(account: Pick<HostingAccount, "status">): boolean {
  return account.status === "active";
}

export function checkHostingAccountAccess(
  account: Pick<HostingAccount, "status">,
): HostingAccountAccessResult {
  if (account.status === "suspended") {
    return {
      ok: false,
      status: 403,
      error: "Hosted AI is temporarily unavailable for this account.",
      reason: "account_suspended",
    };
  }

  if (account.status === "disabled") {
    return {
      ok: false,
      status: 403,
      error: "Hosted AI is disabled for this account.",
      reason: "account_disabled",
    };
  }

  return { ok: true };
}

export async function getHostingAccountByUserId(userId: string): Promise<HostingAccount | null> {
  const [account] = await db()
    .select()
    .from(hostingAccounts)
    .where(eq(hostingAccounts.userId, userId))
    .limit(1);

  return account ?? null;
}

export async function getHostingAccountById(accountId: string): Promise<HostingAccount | null> {
  const [account] = await db()
    .select()
    .from(hostingAccounts)
    .where(eq(hostingAccounts.id, accountId))
    .limit(1);

  return account ?? null;
}

export type CreateHostingAccountInput = {
  userId: string;
  planCode?: HostingPlanCode;
  status?: HostingAccountStatus;
  periodAnchor?: Date;
  limitOverrideMicros?: number | null;
};

export async function createHostingAccount(
  input: CreateHostingAccountInput,
): Promise<HostingAccount> {
  const now = new Date();
  const [account] = await db()
    .insert(hostingAccounts)
    .values({
      id: createId(),
      userId: input.userId,
      status: input.status ?? "active",
      planCode: input.planCode ?? DEFAULT_HOSTING_PLAN_CODE,
      periodAnchor: input.periodAnchor ?? defaultPeriodAnchor(now),
      limitOverrideMicros: input.limitOverrideMicros ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!account) {
    throw new Error("Failed to create hosting account.");
  }

  return account;
}

export async function getOrCreateHostingAccount(userId: string): Promise<HostingAccount> {
  const existing = await getHostingAccountByUserId(userId);
  if (existing) {
    return existing;
  }

  const now = new Date();
  const [inserted] = await db()
    .insert(hostingAccounts)
    .values({
      id: createId(),
      userId,
      status: "active",
      planCode: DEFAULT_HOSTING_PLAN_CODE,
      periodAnchor: defaultPeriodAnchor(now),
      limitOverrideMicros: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: hostingAccounts.userId })
    .returning();

  if (inserted) {
    return inserted;
  }

  const raced = await getHostingAccountByUserId(userId);
  if (!raced) {
    throw new Error(`Failed to provision hosting account for user ${userId}.`);
  }

  return raced;
}

/** Resolve the billable hosting account for an assistant's owner. */
export async function resolveBillableAccountForAssistant(assistant: {
  userId: string;
}): Promise<HostingAccount> {
  return getOrCreateHostingAccount(assistant.userId);
}
