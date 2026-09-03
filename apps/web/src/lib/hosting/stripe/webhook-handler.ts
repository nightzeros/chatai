import type Stripe from "stripe";
import {
  eq,
  hostingAccounts,
  stripeEvents,
  usagePeriodBalances,
  type HostingPlanCode,
} from "@chatai/database";

import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit/log-audit-event";

import { getHostingAccountById } from "../accounts";
import { resolveEffectiveLimitMicros } from "../entitlements";
import { getOrCreateUsagePeriodBalance } from "../period-balance";
import { currentBillingPeriod } from "../period-anchor";
import { CANCELED_PLAN_CODE, planCodeFromPriceMetadata } from "./plans";

/**
 * Attempt to claim a Stripe event for idempotent processing.
 * Returns true if this is the first time we've seen this event.
 */
async function claimEvent(eventId: string, type: string): Promise<boolean> {
  try {
    const [inserted] = await db()
      .insert(stripeEvents)
      .values({ id: eventId, type, processedAt: new Date() })
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning();
    return Boolean(inserted);
  } catch {
    return false;
  }
}

/**
 * Find the hosting account linked to a Stripe subscription or customer.
 */
async function resolveAccountFromSubscription(
  subscription: Stripe.Subscription,
): Promise<string | null> {
  const metaId = subscription.metadata?.hosting_account_id;
  if (metaId) {
    const account = await getHostingAccountById(metaId);
    if (account) return account.id;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const [row] = await db()
    .select({ id: hostingAccounts.id })
    .from(hostingAccounts)
    .where(eq(hostingAccounts.stripeCustomerId, customerId))
    .limit(1);

  return row?.id ?? null;
}

/**
 * Sync hosting account plan and period from a Stripe subscription state change.
 */
async function syncSubscription(subscription: Stripe.Subscription): Promise<void> {
  const accountId = await resolveAccountFromSubscription(subscription);
  if (!accountId) {
    const custId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    console.warn(
      `[stripe-webhook] No hosting account for subscription ${subscription.id} (customer: ${custId})`,
    );
    return;
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // Resolve plan from the first subscription item's price metadata
  const priceItem = subscription.items?.data?.[0];
  const priceMeta = priceItem?.price?.metadata ?? null;
  const planCode: HostingPlanCode = planCodeFromPriceMetadata(priceMeta) ?? "pro";

  const isActive =
    subscription.status === "active" || subscription.status === "trialing";

  const updates: Record<string, unknown> = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    planCode,
    updatedAt: new Date(),
  };

  // Use billing_cycle_anchor to align period (Stripe v22+ doesn't have current_period_start/end)
  if (subscription.billing_cycle_anchor) {
    updates.periodAnchor = new Date(subscription.billing_cycle_anchor * 1000);
  }

  if (!isActive && subscription.status !== "past_due") {
    updates.planCode = CANCELED_PLAN_CODE;
    updates.stripeSubscriptionId = null;
  }

  await db()
    .update(hostingAccounts)
    .set(updates)
    .where(eq(hostingAccounts.id, accountId));

  // Sync period balance limit to match the new plan
  const account = await getHostingAccountById(accountId);
  if (account) {
    const effectiveLimit = await resolveEffectiveLimitMicros(account);
    const { periodStart } = currentBillingPeriod(account.periodAnchor);
    const balance = await getOrCreateUsagePeriodBalance(account);

    if (balance.periodStart.getTime() === periodStart.getTime()) {
      await db()
        .update(usagePeriodBalances)
        .set({ limitMicros: effectiveLimit, updatedAt: new Date() })
        .where(eq(usagePeriodBalances.id, balance.id));
    }

    await logAuditEvent({
      userId: account.userId,
      action: "stripe_subscription_synced",
      resourceType: "hosting_account",
      resourceId: accountId,
      metadata: {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        planCode: account.planCode,
        effectiveLimitMicros: effectiveLimit,
      },
    });
  }
}

/**
 * Handle Checkout Session completion — link customer to account.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const accountId = session.metadata?.hosting_account_id;
  if (!accountId || !session.customer) return;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer.id;

  await db()
    .update(hostingAccounts)
    .set({ stripeCustomerId: customerId, updatedAt: new Date() })
    .where(eq(hostingAccounts.id, accountId));
}

/**
 * Handle invoice.payment_failed — log for admin visibility.
 * Stripe's dunning handles retries; we don't suspend immediately.
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subDetails = (invoice as unknown as Record<string, unknown>).subscription_details as
    | { subscription?: string | { id: string } }
    | undefined;
  const subRef = subDetails?.subscription;
  if (!subRef) return;

  const subscriptionId = typeof subRef === "string" ? subRef : subRef.id;

  const [account] = await db()
    .select()
    .from(hostingAccounts)
    .where(eq(hostingAccounts.stripeSubscriptionId, subscriptionId))
    .limit(1);

  if (!account) return;

  await logAuditEvent({
    userId: account.userId,
    action: "stripe_payment_failed",
    resourceType: "hosting_account",
    resourceId: account.id,
    metadata: {
      invoiceId: invoice.id,
      subscriptionId,
      attemptCount: invoice.attempt_count,
    },
  });
}

// ─── Public dispatch ────────────────────────────────────────────────

export type WebhookResult = { handled: boolean; action?: string };

/**
 * Main webhook event dispatcher. Idempotent: duplicate events are silently skipped.
 */
export async function handleStripeWebhookEvent(
  event: Stripe.Event,
): Promise<WebhookResult> {
  const claimed = await claimEvent(event.id, event.type);
  if (!claimed) {
    return { handled: false, action: "duplicate" };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      return { handled: true, action: "checkout_completed" };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      return { handled: true, action: "subscription_synced" };
    }

    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      return { handled: true, action: "subscription_canceled" };
    }

    case "invoice.paid": {
      // Re-sync subscription to ensure period alignment on renewal.
      const invoice = event.data.object as Stripe.Invoice;
      const subDetails = (invoice as unknown as Record<string, unknown>).subscription_details as
        | { subscription?: string | { id: string } }
        | undefined;
      const subRef = subDetails?.subscription;
      if (subRef) {
        const { requireStripe } = await import("./client");
        const stripe = requireStripe();
        const subId = typeof subRef === "string" ? subRef : subRef.id;
        const subscription = await stripe.subscriptions.retrieve(subId);
        await syncSubscription(subscription);
      }
      return { handled: true, action: "invoice_paid" };
    }

    case "invoice.payment_failed": {
      await handlePaymentFailed(event.data.object as Stripe.Invoice);
      return { handled: true, action: "payment_failed" };
    }

    default:
      return { handled: false, action: "unhandled_type" };
  }
}
