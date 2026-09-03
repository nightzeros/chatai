import type Stripe from "stripe";

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/**
 * Stripe Invoice.subscription was removed in API 2026; the ID now lives under
 * parent.subscription_details / subscription_details.
 */
export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const record = invoice as unknown as {
    parent?: { subscription_details?: { subscription?: unknown } };
    subscription_details?: { subscription?: unknown };
    subscription?: unknown;
  };

  return (
    stripeObjectId(record.parent?.subscription_details?.subscription) ??
    stripeObjectId(record.subscription_details?.subscription) ??
    stripeObjectId(record.subscription)
  );
}
