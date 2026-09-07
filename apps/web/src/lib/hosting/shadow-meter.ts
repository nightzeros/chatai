import { createHash } from "node:crypto";

import {
  calculateCostMicros,
  loadSeedPricingCatalog,
  type ModelPricingRow,
} from "@chatai/billing";
import {
  usageEvents,
  type UsageBillingMode,
  type UsageEventMetadata,
  type UsageOperation,
  type UsagePricingSnapshot,
} from "@chatai/database";
import type { ProviderUsageRecord } from "@chatai/rag/answer";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";

import { loadModelPricingCatalog } from "./pricing-catalog";

export type ShadowUsageSource = "playground" | "widget" | "api" | "ingest" | "eval";

export type RecordShadowUsagesInput = {
  accountId: string;
  assistantId?: string | null;
  requestId: string;
  source?: ShadowUsageSource;
  visitorId?: string | null;
  records: ProviderUsageRecord[];
  /** Per-kind billing mode; defaults to hosted. */
  billingModeFor: (kind: UsageOperation) => UsageBillingMode;
  /** Inject catalog in tests. */
  catalog?: ModelPricingRow[];
  /** Inject insert for tests. */
  insertEvents?: (rows: Array<typeof usageEvents.$inferInsert>) => Promise<void>;
  now?: Date;
};

function hashVisitorId(visitorId?: string | null): string | undefined {
  if (!visitorId) return undefined;
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 16);
}

/** True when we should write shadow/completed usage rows (not when metering is fully off). */
export function isUsageMeteringEnabled(): boolean {
  return env.HOSTED_USAGE_ENFORCEMENT !== "off";
}

async function resolveCatalog(catalog?: ModelPricingRow[]): Promise<ModelPricingRow[]> {
  if (catalog) return catalog;
  try {
    const rows = await loadModelPricingCatalog();
    if (rows.length > 0) return rows;
  } catch {
    // Fall through to seed catalog.
  }
  return loadSeedPricingCatalog();
}

function unitsFor(record: ProviderUsageRecord): number {
  if (record.kind === "rerank") {
    return 1;
  }
  return 0;
}

function toDbSnapshot(snapshot: UsagePricingSnapshot): UsagePricingSnapshot {
  return snapshot;
}

/**
 * Persist provider usage as `status=shadow` ledger rows.
 * Never throws to callers — metering must not break chat/ingest.
 */
export async function recordShadowUsages(input: RecordShadowUsagesInput): Promise<number> {
  if (!isUsageMeteringEnabled()) {
    return 0;
  }

  if (input.records.length === 0) {
    return 0;
  }

  const now = input.now ?? new Date();
  const catalog = await resolveCatalog(input.catalog);
  const visitorIdHash = hashVisitorId(input.visitorId);

  const rows: Array<typeof usageEvents.$inferInsert> = input.records.map((record) => {
    const provider = record.provider ?? "unknown";
    const billingMode = input.billingModeFor(record.kind);
    const units = unitsFor(record);

    const { costMicros, pricingSnapshot } = calculateCostMicros({
      catalog,
      provider,
      model: record.model,
      usageOperation: record.kind,
      at: now,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cachedInputTokens: record.usage.cachedInputTokens,
      totalTokens: record.usage.totalTokens,
      units: units > 0 ? units : undefined,
    });

    // BYOK provider cost is stored for visibility but marked so enforcement can exclude it
    // from NightZeros hosted budget.
    const finalCostMicros = billingMode === "byok" ? 0 : costMicros;

    const metadata: UsageEventMetadata = {
      ...(input.source ? { source: input.source === "ingest" || input.source === "eval" ? "api" : input.source } : {}),
      ...(visitorIdHash ? { visitorIdHash } : {}),
      ...(record.step ? { step: record.step } : {}),
      ...(input.source === "ingest" || input.source === "eval" ? { worker: input.source } : {}),
      ...(billingMode === "byok" && costMicros > 0 ? { byokProviderCostMicros: costMicros } : {}),
    };

    const eventStatus = env.HOSTED_USAGE_ENFORCEMENT === "enforce" ? "completed" : "shadow";

    return {
      id: createId(),
      accountId: input.accountId,
      assistantId: input.assistantId ?? null,
      requestId: input.requestId,
      operation: record.kind,
      provider,
      model: record.model ?? null,
      billingMode,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cachedInputTokens: record.usage.cachedInputTokens,
      totalTokens: record.usage.totalTokens,
      units,
      reservedCostMicros: 0,
      finalCostMicros,
      pricingSnapshot: toDbSnapshot(pricingSnapshot),
      status: eventStatus,
      metadata,
      createdAt: now,
      completedAt: now,
    };
  });

  try {
    if (input.insertEvents) {
      await input.insertEvents(rows);
    } else {
      await db().insert(usageEvents).values(rows);
    }
    return rows.length;
  } catch (error) {
    console.error("[usage] Failed to record shadow usage events", {
      accountId: input.accountId,
      requestId: input.requestId,
      count: rows.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
