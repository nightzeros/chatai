import type { ModelPricingOperation, ModelPricingRow, ModelPricingUnit } from "./types";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isActiveAt(row: ModelPricingRow, at: Date): boolean {
  const from = toDate(row.effectiveFrom);
  if (from.getTime() > at.getTime()) {
    return false;
  }
  if (row.effectiveTo == null) {
    return true;
  }
  return toDate(row.effectiveTo).getTime() > at.getTime();
}

/**
 * Resolve the effective rate for a provider/model/operation at a point in time.
 * Prefers an exact model match over provider wildcard `*`, then the latest effectiveFrom.
 */
export function findEffectiveRate(
  catalog: readonly ModelPricingRow[],
  input: {
    provider: string;
    model?: string | null;
    operation: ModelPricingOperation;
    at?: Date;
  },
): ModelPricingRow | null {
  const at = input.at ?? new Date();
  const provider = input.provider.trim().toLowerCase();
  const model = (input.model ?? "").trim() || null;

  const candidates = catalog.filter(
    (row) =>
      row.provider.toLowerCase() === provider &&
      row.operation === input.operation &&
      isActiveAt(row, at) &&
      (row.model === "*" || (model != null && row.model === model)),
  );

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const exactA = model != null && a.model === model ? 1 : 0;
    const exactB = model != null && b.model === model ? 1 : 0;
    if (exactA !== exactB) {
      return exactB - exactA;
    }
    return toDate(b.effectiveFrom).getTime() - toDate(a.effectiveFrom).getTime();
  });

  return candidates[0] ?? null;
}

/** Apply a unit price to a quantity using integer micro-dollar math. */
export function applyRateMicros(
  quantity: number,
  priceMicrosPerUnit: number,
  unit: ModelPricingUnit,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 0;
  }
  if (!Number.isFinite(priceMicrosPerUnit) || priceMicrosPerUnit < 0) {
    return 0;
  }

  switch (unit) {
    case "per_million_tokens":
      return Math.floor((quantity * priceMicrosPerUnit) / 1_000_000);
    case "per_1k_tokens":
      return Math.floor((quantity * priceMicrosPerUnit) / 1_000);
    case "per_request":
      return Math.floor(quantity * priceMicrosPerUnit);
    default: {
      const _exhaustive: never = unit;
      return _exhaustive;
    }
  }
}
