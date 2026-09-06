import { env } from "@/lib/env";

import {
  parsePolarPlanProductMap,
  parsePolarProductAllowlist,
  type PolarProductConfig,
} from "./plans";

function polarProductConfig(): PolarProductConfig {
  return {
    starterProductId: env.POLAR_PRODUCT_ID_STARTER,
    proProductId: env.POLAR_PRODUCT_ID_PRO,
    businessProductId: env.POLAR_PRODUCT_ID_BUSINESS,
    teamProductId: env.POLAR_PRODUCT_ID_TEAM,
  };
}

/** productId → planCode (webhooks). */
export function currentPolarProductAllowlist() {
  return parsePolarProductAllowlist(polarProductConfig());
}

/** planCode → productId (checkout). */
export function currentPolarPlanProductMap() {
  return parsePolarPlanProductMap(polarProductConfig());
}
