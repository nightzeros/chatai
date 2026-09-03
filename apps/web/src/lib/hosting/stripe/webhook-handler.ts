import type Stripe from "stripe";
import {
  eq,
  hostingAccounts,
  stripeEvents,
  usagePeriodBalances,
} from "@chatai/database";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";

import { getHostingAccountById } from "../accounts";
import { resolveEffectiveLimitMicros } from "../entitlements";
import { currentBillingPeriod } from "../period-anchor";
import { getOrCreateUsagePeriodBalance } from "../period-balance";
import { currentStripePriceAllowlist } from "./allowlist";
import { subscriptionIdFromInvoice } from "./invoice";
import { CANCELED_PLAN_CODE, planCodeForPriceId } from "./plans";

/**
 * Attempt to claim a Stripe event for idempotent processing.
 * Returns true if this is the first time we've seen this event.
 * Callers must `releaseStripeEvent` if processing fails so Stripe can retry.
 */
export async function claimStripeEvent(eventId: string, type: string): Promise<boolean> {
  const [inserted] = await db()
    .insert(stripeEvents)
    .values({ id: eventId, type, processedAt: new Date() })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning();
  return Boolean(inserted);
}

export async function releaseStripeEvent(eventId: string): Promise<void> {
  await db().delete(stripeEvents).where(eq(stripeEvents.id, eventId));
}

function customerIdFromSubscription(subscription: Stripe.Subscription): string {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
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

  const customerId = customerIdFromSubscription(subscription);
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
    console.warn(
      `[stripe-webhook] No hosting account for subscription ${subscription.id} (customer: ${customerIdFromSubscription(subscription)})`,
    );
    return;
  }

  const customerId = customerIdFromSubscription(subscription);
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const mappedPlan = planCodeForPriceId(priceId, currentStripePriceAllowlist());

  const isActive =
    subscription.status === "active" || subscription.status === "trialing";
  const isPastDue = subscription.status === "past_due";

  const updates: Record<string, unknown> = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    updatedAt: new Date(),
  };

  if (subscription.billing_cycle_anchor) {
    updates.periodAnchor = new Date(subscription.billing_cycle_anchor * 1000);
  }

  if (!isActive && !isPastDue) {
    updates.planCode = CANCELED_PLAN_CODE;
    updates.stripeSubscriptionId = null;
  } else if (mappedPlan) {
    updates.planCode = mappedPlan;
  } else {
    console.warn(
      `[stripe-webhook] Unmapped Stripe price ${priceId ?? "(none)"} on subscription ${subscription.id}; not changing plan_code`,
    );
  }

  await db()
    .update(hostingAccounts)
    .set(updates)
    .where(eq(hostingAccounts.id, accountId));

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
        priceId: priceId ?? null,
        effectiveLimitMicros: effectiveLimit,
      },
    });
  }
}

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

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

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

export type WebhookResult = { handled: boolean; action?: string };

/**
 * Main webhook event dispatcher. Idempotent: duplicate events are skipped.
 * Processing failures release the claim so Stripe retries can re-run.
 */
export async function handleStripeWebhookEvent(
  event: Stripe.Event,
): Promise<WebhookResult> {
  const claimed = await claimStripeEvent(event.id, event.type);
  if (!claimed) {
    return { handled: false, action: "duplicate" };
  }

  try {
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
        const invoice = event.data.object as Stripe.Invoice;
        const subId = subscriptionIdFromInvoice(invoice);
        if (subId) {
          const { requireStripe } = await import("./client");
          const stripe = requireStripe();
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
  } catch (err) {
    await releaseStripeEvent(event.id);
    throw err;
  }
}
