import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { subscriptionIdFromInvoice } from "../invoice";

describe("subscriptionIdFromInvoice", () => {
  it("reads parent.subscription_details.subscription string", () => {
    const invoice = {
      parent: { subscription_details: { subscription: "sub_parent" } },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe("sub_parent");
  });

  it("reads expanded subscription objects", () => {
    const invoice = {
      subscription_details: { subscription: { id: "sub_expanded" } },
    } as unknown as Stripe.Invoice;
    expect(subscriptionIdFromInvoice(invoice)).toBe("sub_expanded");
  });

  it("returns null when no subscription is present", () => {
    expect(subscriptionIdFromInvoice({} as Stripe.Invoice)).toBeNull();
  });
});
