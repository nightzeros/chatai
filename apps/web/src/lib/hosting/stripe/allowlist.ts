import { env } from "@/lib/env";

import { parseStripePriceAllowlist } from "./plans";

export function currentStripePriceAllowlist() {
  return parseStripePriceAllowlist({
    proPriceId: env.STRIPE_PRICE_ID_PRO,
    teamPriceId: env.STRIPE_PRICE_ID_TEAM,
  });
}
