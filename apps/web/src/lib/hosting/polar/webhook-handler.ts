import type { Checkout } from "@polar-sh/sdk/models/components/checkout.js";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import {
  eq,
  hostingAccounts,
  polarEvents,
  usagePeriodBalances,
} from "@chatai/database";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";

import { getHostingAccountById } from "../accounts";
import { resolveEffectiveLimitMicros } from "../entitlements";
import { currentBillingPeriod } from "../period-anchor";
import { getOrCreateUsagePeriodBalance } from "../period-balance";
import { resolveVoiceSecondsLimit } from "../plan-entitlements";
import { currentPolarProductAllowlist } from "./allowlist";
import { CANCELED_PLAN_CODE, planCodeForProductId } from "./plans";
import { shouldGrantPaidPlan, shouldRevertToFree } from "./status";

export type PolarWebhookEvent = {
  type: string;
  timestamp?: Date;
  data: unknown;
};

/**
 * Attempt to claim a Polar event for idempotent processing.
 * Callers must `releasePolarEvent` if processing fails so Polar can retry.
 */
export async function claimPolarEvent(eventId: string, type: string): Promise<boolean> {
  const [inserted] = await db()
    .insert(polarEvents)
    .values({ id: eventId, type, processedAt: new Date() })
    .onConflictDoNothing({ target: polarEvents.id })
    .returning();
  return Boolean(inserted);
}

export async function releasePolarEvent(eventId: string): Promise<void> {
  await db().delete(polarEvents).where(eq(polarEvents.id, eventId));
}

async function resolveAccountId(input: {
  hostingAccountId?: string | null;
  externalCustomerId?: string | null;
  polarCustomerId?: string | null;
}): Promise<string | null> {
  if (input.hostingAccountId) {
    const account = await getHostingAccountById(input.hostingAccountId);
    if (account) return account.id;
  }

  if (input.externalCustomerId) {
    const account = await getHostingAccountById(input.externalCustomerId);
    if (account) return account.id;
  }

  if (input.polarCustomerId) {
    const [row] = await db()
      .select({ id: hostingAccounts.id })
      .from(hostingAccounts)
      .where(eq(hostingAccounts.polarCustomerId, input.polarCustomerId))
      .limit(1);
    return row?.id ?? null;
  }

  return null;
}

async function syncSubscription(subscription: Subscription): Promise<void> {
  const metadataAccountId =
    typeof subscription.metadata?.hosting_account_id === "string"
      ? subscription.metadata.hosting_account_id
      : null;

  const accountId = await resolveAccountId({
    hostingAccountId: metadataAccountId,
    externalCustomerId: subscription.customer.externalId ?? null,
    polarCustomerId: subscription.customerId,
  });

  if (!accountId) {
    console.warn(
      `[polar-webhook] No hosting account for subscription ${subscription.id} (customer: ${subscription.customerId})`,
    );
    return;
  }

  const mappedPlan = planCodeForProductId(
    subscription.productId,
    currentPolarProductAllowlist(),
  );

  const updates: Record<string, unknown> = {
    polarCustomerId: subscription.customerId,
    polarSubscriptionId: subscription.id,
    updatedAt: new Date(),
  };

  if (subscription.currentPeriodStart) {
    updates.periodAnchor = new Date(subscription.currentPeriodStart);
  }

  if (shouldRevertToFree(subscription.status)) {
    updates.planCode = CANCELED_PLAN_CODE;
    updates.polarSubscriptionId = null;
  } else if (shouldGrantPaidPlan(subscription.status) && mappedPlan) {
    updates.planCode = mappedPlan;
  } else if (shouldGrantPaidPlan(subscription.status) && !mappedPlan) {
    console.warn(
      `[polar-webhook] Unmapped Polar product ${subscription.productId} on subscription ${subscription.id}; not changing plan_code`,
    );
  }

  await db()
    .update(hostingAccounts)
    .set(updates)
    .where(eq(hostingAccounts.id, accountId));

  const account = await getHostingAccountById(accountId);
  if (!account) return;

  const effectiveLimit = await resolveEffectiveLimitMicros(account);
  const { periodStart } = currentBillingPeriod(account.periodAnchor);
  const balance = await getOrCreateUsagePeriodBalance(account);

  if (balance.periodStart.getTime() === periodStart.getTime()) {
    const voiceSecondsLimit = await resolveVoiceSecondsLimit(account);
    await db()
      .update(usagePeriodBalances)
      .set({ limitMicros: effectiveLimit, voiceSecondsLimit, updatedAt: new Date() })
      .where(eq(usagePeriodBalances.id, balance.id));
  }

  await logAuditEvent({
    userId: account.userId,
    action: "polar_subscription_synced",
    resourceType: "hosting_account",
    resourceId: accountId,
    metadata: {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      planCode: account.planCode,
      productId: subscription.productId,
      effectiveLimitMicros: effectiveLimit,
    },
  });
}

async function handleCheckoutUpdated(checkout: Checkout): Promise<void> {
  if (checkout.status !== "succeeded" && checkout.status !== "confirmed") {
    return;
  }

  const metadataAccountId =
    typeof checkout.metadata?.hosting_account_id === "string"
      ? checkout.metadata.hosting_account_id
      : null;

  const accountId = await resolveAccountId({
    hostingAccountId: metadataAccountId,
    externalCustomerId: checkout.externalCustomerId,
    polarCustomerId: checkout.customerId,
  });

  if (!accountId || !checkout.customerId) return;

  await db()
    .update(hostingAccounts)
    .set({
      polarCustomerId: checkout.customerId,
      updatedAt: new Date(),
    })
    .where(eq(hostingAccounts.id, accountId));
}

async function handlePaymentFailed(subscription: Subscription): Promise<void> {
  const accountId = await resolveAccountId({
    externalCustomerId: subscription.customer.externalId ?? null,
    polarCustomerId: subscription.customerId,
  });
  if (!accountId) return;

  const account = await getHostingAccountById(accountId);
  if (!account) return;

  await logAuditEvent({
    userId: account.userId,
    action: "polar_payment_failed",
    resourceType: "hosting_account",
    resourceId: account.id,
    metadata: {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
  });
}

export type WebhookResult = { handled: boolean; action?: string };

/**
 * Main webhook event dispatcher. Idempotent: duplicate events are skipped.
 * Processing failures release the claim so Polar retries can re-run.
 */
export async function handlePolarWebhookEvent(
  event: PolarWebhookEvent,
  eventId: string,
): Promise<WebhookResult> {
  const claimed = await claimPolarEvent(eventId, event.type);
  if (!claimed) {
    return { handled: false, action: "duplicate" };
  }

  try {
    switch (event.type) {
      case "checkout.updated": {
        await handleCheckoutUpdated(event.data as Checkout);
        return { handled: true, action: "checkout_updated" };
      }

      case "subscription.created":
      case "subscription.active":
      case "subscription.updated":
      case "subscription.uncanceled": {
        await syncSubscription(event.data as Subscription);
        return { handled: true, action: "subscription_synced" };
      }

      case "subscription.canceled":
      case "subscription.revoked": {
        await syncSubscription(event.data as Subscription);
        return { handled: true, action: "subscription_canceled" };
      }

      case "subscription.past_due": {
        await handlePaymentFailed(event.data as Subscription);
        return { handled: true, action: "payment_failed" };
      }

      default:
        return { handled: false, action: "unhandled_type" };
    }
  } catch (err) {
    await releasePolarEvent(eventId);
    throw err;
  }
}
