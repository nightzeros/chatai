import { modelPricing } from "@chatai/database";

import { db } from "@/lib/db";

import { loadSeedPricingCatalog, mergeSeedPricing, type ModelPricingRow } from "@chatai/billing";

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

/** DB catalog plus seed-merged operations; the full seed when the table is empty or unreachable. */
export async function resolvePricingCatalog(catalog?: ModelPricingRow[]): Promise<ModelPricingRow[]> {
  if (catalog) return catalog;
  try {
    const rows = await loadModelPricingCatalog();
    if (rows.length > 0) return mergeSeedPricing(rows);
  } catch {
    // fall through
  }
  return loadSeedPricingCatalog();
}
