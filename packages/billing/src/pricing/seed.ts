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
 * Operations whose seed rates are merged when the database has no row for that
 * provider/model/operation. Enum values added by a migration cannot be seeded in the
 * same migration run, so these rates live here; a DB row for the same key (e.g. a new
 * effective-dated price) always wins. Other operations keep DB-only semantics.
 */
const SEED_MERGED_OPERATIONS: readonly ModelPricingOperation[] = ["voice_realtime"];

function catalogKey(row: Pick<ModelPricingRow, "provider" | "model" | "operation">): string {
  return `${row.provider.toLowerCase()}|${row.model}|${row.operation}`;
}

export function mergeSeedPricing(
  dbRows: ModelPricingRow[],
  seedRows: ModelPricingRow[] = loadSeedPricingCatalog(),
): ModelPricingRow[] {
  const present = new Set(dbRows.map(catalogKey));
  const missing = seedRows.filter(
    (row) => SEED_MERGED_OPERATIONS.includes(row.operation) && !present.has(catalogKey(row)),
  );
  return missing.length > 0 ? [...dbRows, ...missing] : dbRows;
}

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
