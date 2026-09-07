import { requirePolar } from "./client";

export type CreatePortalInput = {
  polarCustomerId: string;
  returnUrl: string;
};

/**
 * Create a Polar Customer Portal session for managing the subscription.
 */
export async function createPortalSession(
  input: CreatePortalInput,
): Promise<{ url: string }> {
  const polar = requirePolar();

  const session = await polar.customerSessions.create({
    customerId: input.polarCustomerId,
    returnUrl: input.returnUrl,
  });

  return { url: session.customerPortalUrl };
}
