import {
  calculateCostMicros,
  loadSeedPricingCatalog,
  type ModelPricingRow,
} from "@chatai/billing";
import {
  eq,
  usageEvents,
  type UsageBillingMode,
  type UsageEventMetadata,
  type UsageOperation,
} from "@chatai/database";
import type { EmbeddingConfig } from "@chatai/ai";
import type { ProviderUsageRecord } from "@chatai/rag/answer";

import type { AssistantBillingModes } from "@/lib/ai-config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";

import type { HostingAccount } from "./accounts";
import { resolvePlanRequestCap } from "./entitlements";
import { estimateChatRequestCostMicros } from "./estimate-chat-cost";
import { estimateIngestEmbeddingCostMicros } from "./estimate-ingest-cost";
import { getOrCreateUsagePeriodBalance } from "./period-balance";
import { loadModelPricingCatalog } from "./pricing-catalog";
import { reconcileUsage, releaseUsage, reserveUsage } from "./reservation";
import { recordShadowUsages } from "./shadow-meter";
import { UsageLimitExceededError } from "./usage-limit-error";

export type UsageGateReservation = {
  accountId: string;
  periodStart: Date;
  reservedMicros: number;
  reservationEventId: string;
  requestId: string;
  estimateMicros: number;
};

export type BeginChatReservationResult =
  | { ok: true; reservation: UsageGateReservation | null }
  | { ok: false; status: 402; error: string; reason: "usage_limit_exceeded" };

const LIMIT_EXCEEDED: BeginChatReservationResult = {
  ok: false,
  status: 402,
  error: "Usage limit exceeded for this billing period.",
  reason: "usage_limit_exceeded",
};

async function resolveCatalog(catalog?: ModelPricingRow[]): Promise<ModelPricingRow[]> {
  if (catalog) return catalog;
  try {
    const rows = await loadModelPricingCatalog();
    if (rows.length > 0) return rows;
  } catch {
    // fall through
  }
  return loadSeedPricingCatalog();
}

export function isUsageEnforcementEnabled(): boolean {
  return env.HOSTED_USAGE_ENFORCEMENT === "enforce";
}

function isPlaygroundExempt(source?: "playground" | "widget" | "api"): boolean {
  return Boolean(env.HOSTED_USAGE_EXEMPT_PLAYGROUND && source === "playground");
}

async function assertRequestCapAllows(
  account: HostingAccount,
  requestCount: number,
): Promise<boolean> {
  const cap = await resolvePlanRequestCap(account);
  if (cap == null) return true;
  return requestCount < cap;
}

async function createReservationEvent(input: {
  accountId: string;
  assistantId: string;
  requestId: string;
  operation: UsageOperation;
  provider: string;
  model: string;
  reservedMicros: number;
  periodStart: Date;
  metadata?: UsageEventMetadata;
}): Promise<string> {
  const reservationEventId = createId();
  await db().insert(usageEvents).values({
    id: reservationEventId,
    accountId: input.accountId,
    assistantId: input.assistantId,
    requestId: input.requestId,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    billingMode: "hosted",
    reservedCostMicros: input.reservedMicros,
    finalCostMicros: 0,
    status: "reserved",
    metadata: {
      ...input.metadata,
      periodStart: input.periodStart.toISOString(),
    },
    createdAt: new Date(),
  });
  return reservationEventId;
}

export type BeginChatReservationInput = {
  account: HostingAccount;
  assistantId: string;
  requestId: string;
  chat: Parameters<typeof estimateChatRequestCostMicros>[0]["chat"];
  embedding: Parameters<typeof estimateChatRequestCostMicros>[0]["embedding"];
  billing: AssistantBillingModes;
  message: string;
  hasHistory: boolean;
  queryExpansionEnabled: boolean;
  rerankEnabled: boolean;
  verifyCitationsEnabled: boolean;
  hasCohereKey: boolean;
  source?: "playground" | "widget" | "api";
  catalog?: ModelPricingRow[];
};

/**
 * When enforcement is on, reserve a conservative cost ceiling before provider calls.
 * Returns `reservation: null` in shadow/off modes (no blocking).
 */
export async function beginChatUsageReservation(
  input: BeginChatReservationInput,
): Promise<BeginChatReservationResult> {
  if (!isUsageEnforcementEnabled() || isPlaygroundExempt(input.source)) {
    return { ok: true, reservation: null };
  }

  const catalog = await resolveCatalog(input.catalog);
  const { estimateMicros, components } = estimateChatRequestCostMicros({
    catalog,
    chat: input.chat,
    embedding: input.embedding,
    billing: input.billing,
    message: input.message,
    hasHistory: input.hasHistory,
    queryExpansionEnabled: input.queryExpansionEnabled,
    rerankEnabled: input.rerankEnabled,
    verifyCitationsEnabled: input.verifyCitationsEnabled,
    hasCohereKey: input.hasCohereKey,
    maxOutputTokens: env.HOSTED_USAGE_MAX_OUTPUT_TOKENS,
  });

  const balance = await getOrCreateUsagePeriodBalance(input.account);
  if (!(await assertRequestCapAllows(input.account, balance.requestCount))) {
    return LIMIT_EXCEEDED;
  }

  const reserved = await reserveUsage({
    accountId: input.account.id,
    periodStart: balance.periodStart,
    estimateMicros,
  });

  if (!reserved.ok) {
    return LIMIT_EXCEEDED;
  }

  const reservationEventId = await createReservationEvent({
    accountId: input.account.id,
    assistantId: input.assistantId,
    requestId: input.requestId,
    operation: "chat_completion",
    provider: input.chat.provider ?? "unknown",
    model: input.chat.model,
    reservedMicros: reserved.estimateMicros,
    periodStart: balance.periodStart,
    metadata: {
      ...(input.source ? { source: input.source } : {}),
      estimateComponents: components,
    },
  });

  return {
    ok: true,
    reservation: {
      accountId: input.account.id,
      periodStart: balance.periodStart,
      reservedMicros: reserved.estimateMicros,
      reservationEventId,
      requestId: input.requestId,
      estimateMicros: reserved.estimateMicros,
    },
  };
}

function billingModeFor(
  billing: AssistantBillingModes,
  kind: UsageOperation,
): UsageBillingMode {
  if (kind === "embedding") return billing.embedding;
  if (kind === "rerank") return billing.rerank;
  return billing.chat;
}

/**
 * After provider calls: write ledger events, reconcile reservation, mark parent complete.
 */
export async function finishChatUsageReservation(input: {
  reservation: UsageGateReservation | null;
  accountId: string;
  assistantId: string;
  requestId: string;
  source?: "playground" | "widget" | "api";
  visitorId?: string | null;
  records: ProviderUsageRecord[];
  billing: AssistantBillingModes;
  catalog?: ModelPricingRow[];
  failed?: boolean;
}): Promise<void> {
  const catalog = await resolveCatalog(input.catalog);

  await recordShadowUsages({
    accountId: input.accountId,
    assistantId: input.assistantId,
    requestId: input.requestId,
    source: input.source,
    visitorId: input.visitorId,
    records: input.records,
    catalog,
    billingModeFor: (kind) => billingModeFor(input.billing, kind),
  });

  if (!input.reservation) {
    return;
  }

  const now = new Date();
  let actualMicros = 0;

  if (!input.failed) {
    for (const record of input.records) {
      const mode = billingModeFor(input.billing, record.kind);
      if (mode !== "hosted") continue;
      const { costMicros } = calculateCostMicros({
        catalog,
        provider: record.provider ?? "unknown",
        model: record.model,
        usageOperation: record.kind,
        at: now,
        inputTokens: record.usage.inputTokens,
        outputTokens: record.usage.outputTokens,
        cachedInputTokens: record.usage.cachedInputTokens,
        totalTokens: record.usage.totalTokens,
        units: record.kind === "rerank" ? 1 : undefined,
      });
      actualMicros += costMicros;
    }
  }

  await reconcileUsage({
    accountId: input.reservation.accountId,
    periodStart: input.reservation.periodStart,
    reservedMicros: input.reservation.reservedMicros,
    actualMicros: input.failed ? 0 : actualMicros,
    incrementRequestCount: !input.failed,
  });

  await db()
    .update(usageEvents)
    .set({
      status: input.failed ? "failed" : "completed",
      finalCostMicros: input.failed ? 0 : actualMicros,
      completedAt: now,
      ...(input.failed ? { errorCode: "provider_or_request_failed" } : {}),
    })
    .where(eq(usageEvents.id, input.reservation.reservationEventId));
}

/** Release reservation without consuming (call from catch; skip finish afterward). */
export async function abortChatUsageReservation(
  reservation: UsageGateReservation | null,
): Promise<void> {
  if (!reservation) return;

  await releaseUsage({
    accountId: reservation.accountId,
    periodStart: reservation.periodStart,
    reservedMicros: reservation.reservedMicros,
  });

  await db()
    .update(usageEvents)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorCode: "aborted",
      finalCostMicros: 0,
    })
    .where(eq(usageEvents.id, reservation.reservationEventId));
}

/**
 * Reserve estimated ingest embedding cost. Throws UsageLimitExceededError when blocked.
 * Returns null when enforcement is off (shadow/off).
 */
export async function beginIngestUsageReservation(input: {
  account: HostingAccount;
  assistantId: string;
  requestId: string;
  embedding: EmbeddingConfig;
  billingMode: UsageBillingMode;
  approxTokens: number;
  catalog?: ModelPricingRow[];
}): Promise<UsageGateReservation | null> {
  if (!isUsageEnforcementEnabled()) {
    return null;
  }

  const catalog = await resolveCatalog(input.catalog);
  const { estimateMicros } = estimateIngestEmbeddingCostMicros({
    catalog,
    embedding: input.embedding,
    billingMode: input.billingMode,
    approxTokens: input.approxTokens,
  });

  const balance = await getOrCreateUsagePeriodBalance(input.account);
  if (!(await assertRequestCapAllows(input.account, balance.requestCount))) {
    throw new UsageLimitExceededError();
  }

  const reserved = await reserveUsage({
    accountId: input.account.id,
    periodStart: balance.periodStart,
    estimateMicros,
  });

  if (!reserved.ok) {
    throw new UsageLimitExceededError();
  }

  const reservationEventId = await createReservationEvent({
    accountId: input.account.id,
    assistantId: input.assistantId,
    requestId: input.requestId,
    operation: "embedding",
    provider: input.embedding.provider ?? "unknown",
    model: input.embedding.model,
    reservedMicros: reserved.estimateMicros,
    periodStart: balance.periodStart,
    metadata: {
      source: "api",
      worker: "ingest",
      approxTokens: input.approxTokens,
    },
  });

  return {
    accountId: input.account.id,
    periodStart: balance.periodStart,
    reservedMicros: reserved.estimateMicros,
    reservationEventId,
    requestId: input.requestId,
    estimateMicros: reserved.estimateMicros,
  };
}

export async function finishIngestUsageReservation(input: {
  reservation: UsageGateReservation | null;
  accountId: string;
  assistantId: string;
  requestId: string;
  embedding: EmbeddingConfig;
  billingMode: UsageBillingMode;
  usage: ProviderUsageRecord["usage"] | null;
  catalog?: ModelPricingRow[];
}): Promise<void> {
  const catalog = await resolveCatalog(input.catalog);

  if (input.usage) {
    await recordShadowUsages({
      accountId: input.accountId,
      assistantId: input.assistantId,
      requestId: input.requestId,
      source: "ingest",
      records: [
        {
          kind: "embedding",
          provider: input.embedding.provider,
          model: input.embedding.model,
          usage: input.usage,
          step: "document_ingest",
        },
      ],
      catalog,
      billingModeFor: () => input.billingMode,
    });
  }

  if (!input.reservation) {
    return;
  }

  const now = new Date();
  let actualMicros = 0;

  if (input.usage && input.billingMode === "hosted") {
    actualMicros = calculateCostMicros({
      catalog,
      provider: input.embedding.provider ?? "unknown",
      model: input.embedding.model,
      usageOperation: "embedding",
      at: now,
      totalTokens: input.usage.totalTokens,
    }).costMicros;
  }

  await reconcileUsage({
    accountId: input.reservation.accountId,
    periodStart: input.reservation.periodStart,
    reservedMicros: input.reservation.reservedMicros,
    actualMicros,
    incrementRequestCount: Boolean(input.usage),
  });

  await db()
    .update(usageEvents)
    .set({
      status: "completed",
      finalCostMicros: actualMicros,
      completedAt: now,
    })
    .where(eq(usageEvents.id, input.reservation.reservationEventId));
}

export async function abortIngestUsageReservation(
  reservation: UsageGateReservation | null,
): Promise<void> {
  await abortChatUsageReservation(reservation);
}
