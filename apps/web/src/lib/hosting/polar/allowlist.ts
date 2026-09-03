import { env } from "@/lib/env";

import { parsePolarProductAllowlist } from "./plans";

export function currentPolarProductAllowlist() {
  return parsePolarProductAllowlist({
    proProductId: env.POLAR_PRODUCT_ID_PRO,
    teamProductId: env.POLAR_PRODUCT_ID_TEAM,
  });
}
