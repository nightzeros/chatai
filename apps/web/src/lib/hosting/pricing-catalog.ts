import { modelPricing } from "@chatai/database";

import { db } from "@/lib/db";

import type { ModelPricingRow } from "@chatai/billing";

/**
 * Load active + historical pricing rows from Postgres for cost calculation.
 * Falls back to empty array when the table has not been seeded yet.
 */
export async function loadModelPricingCatalog(): Promise<ModelPricingRow[]> {
  const rows = await db().select().from(modelPricing);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    priceMicrosPerUnit: row.priceMicrosPerUnit,
    unit: row.unit,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));
}
