import seed from "./seed.json";
import type { ModelPricingOperation, ModelPricingRow, ModelPricingUnit } from "./types";

type SeedRow = {
  id: string;
  provider: string;
  model: string;
  operation: ModelPricingOperation;
  priceMicrosPerUnit: number;
  unit: ModelPricingUnit;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

/**
 * Built-in catalog shipped with the package. Prefer DB `model_pricing` at runtime;
 * use this for tests, offline calc, and migration seed source-of-truth.
 */
export function loadSeedPricingCatalog(): ModelPricingRow[] {
  return (seed as SeedRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    priceMicrosPerUnit: row.priceMicrosPerUnit,
    unit: row.unit,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo ?? null,
  }));
}
