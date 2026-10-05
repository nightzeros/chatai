import {
  calculateCostMicros,
  loadSeedPricingCatalog,
  mergeSeedPricing,
  type ModelPricingRow,
} from "@chatai/billing";
import {
  and,
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
  error:
    "You've reached your monthly hosted AI allowance. Upgrade your plan or wait until your usage period resets.",
  reason: "usage_limit_exceeded",
};

async function resolveCatalog(catalog?: ModelPricingRow[]): Promise<ModelPricingRow[]> {
  if (catalog) return catalog;
  try {
    const rows = await loadModelPricingCatalog();
    if (rows.length > 0) return mergeSeedPricing(rows);
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
  historyChars: number;
  queryExpansionEnabled: boolean;
  rerankEnabled: boolean;
  verifyCitationsEnabled: boolean;
  hasCohereKey: boolean;
  /** The output scope check may add one small call. */
  outputScopeCheck?: boolean;
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
    historyChars: input.historyChars,
    queryExpansionEnabled: input.queryExpansionEnabled,
    rerankEnabled: input.rerankEnabled,
    verifyCitationsEnabled: input.verifyCitationsEnabled,
    hasCohereKey: input.hasCohereKey,
    maxOutputTokens: env.HOSTED_USAGE_MAX_OUTPUT_TOKENS,
    ...(input.outputScopeCheck ? { outputScopeCheck: true } : {}),
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
  // Voice always runs on the instance GPT-Live key (never BYOK).
  if (kind === "voice_realtime") return "hosted";
  return billing.chat;
}

/**
 * After provider calls: write ledger events, reconcile reservation, mark parent complete.
 * Shadow-meter / event-row failures must not leave reserved micros stranded.
 * `failed`: the request did not complete; the usage it already incurred is still
 * charged, but it does not count toward the request cap.
 */
export async function finishChatUsageReservation(input: {
  reservation: UsageGateReservation | null;
  accountId: string;
  assistantId: string;
  requestId: string;
  source?: "playground" | "widget" | "api" | "eval" | "ingest";
  visitorId?: string | null;
  records: ProviderUsageRecord[];
  billing: AssistantBillingModes;
  catalog?: ModelPricingRow[];
  failed?: boolean;
}): Promise<void> {
  const catalog = await resolveCatalog(input.catalog);
  const now = new Date();
  let actualMicros = 0;

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

  try {
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
  } catch (error) {
    console.error("[usage] shadow metering failed during finish:", error);
  }

  if (!input.reservation) {
    return;
  }

  const claimed = await claimReservationEvent(input.reservation.reservationEventId, {
    status: input.failed ? "failed" : "completed",
    finalCostMicros: actualMicros,
    completedAt: now,
    ...(input.failed ? { errorCode: "provider_or_request_failed" } : {}),
  });

  // Unclaimed: the stale reconciler already abandoned the row and released its
  // reservation, so only the real consumption is still owed.
  await reconcileUsage({
    accountId: input.reservation.accountId,
    periodStart: input.reservation.periodStart,
    reservedMicros: claimed ? input.reservation.reservedMicros : 0,
    actualMicros,
    incrementRequestCount: !input.failed,
  });
}

/**
 * Move a reservation row out of `reserved` exactly once. Only the caller that wins
 * the claim may release its reserved micros, so finish, abort and the stale
 * reconciler can never release the same reservation twice.
 */
async function claimReservationEvent(
  eventId: string,
  values: Partial<typeof usageEvents.$inferInsert>,
): Promise<boolean> {
  try {
    const rows = await db()
      .update(usageEvents)
      .set(values)
      .where(and(eq(usageEvents.id, eventId), eq(usageEvents.status, "reserved")))
      .returning({ id: usageEvents.id });
    return rows.length > 0;
  } catch (error) {
    console.error("[usage] reservation event claim failed:", error);
    return false;
  }
}

/** Release reservation without consuming (call from catch; skip finish afterward). */
export async function abortChatUsageReservation(
  reservation: UsageGateReservation | null,
): Promise<void> {
  if (!reservation) return;

  const claimed = await claimReservationEvent(reservation.reservationEventId, {
    status: "failed",
    completedAt: new Date(),
    errorCode: "aborted",
    finalCostMicros: 0,
  });
  if (!claimed) return;

  await releaseUsage({
    accountId: reservation.accountId,
    periodStart: reservation.periodStart,
    reservedMicros: reservation.reservedMicros,
  });
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

  if (input.usage) {
    try {
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
    } catch (error) {
      console.error("[usage] shadow metering failed during ingest finish:", error);
    }
  }

  if (!input.reservation) {
    return;
  }

  await reconcileUsage({
    accountId: input.reservation.accountId,
    periodStart: input.reservation.periodStart,
    reservedMicros: input.reservation.reservedMicros,
    actualMicros,
    incrementRequestCount: Boolean(input.usage),
  });

  try {
    await db()
      .update(usageEvents)
      .set({
        status: "completed",
        finalCostMicros: actualMicros,
        completedAt: now,
      })
      .where(eq(usageEvents.id, input.reservation.reservationEventId));
  } catch (error) {
    console.error("[usage] ingest reservation event finalize failed:", error);
  }
}

export async function abortIngestUsageReservation(
  reservation: UsageGateReservation | null,
): Promise<void> {
  await abortChatUsageReservation(reservation);
}

function estimateJudgeCallsMicros(input: {
  catalog: ModelPricingRow[];
  chat: import("@chatai/ai").ChatConfig;
  billing: AssistantBillingModes;
  judgeCount?: number;
}): number {
  if (input.billing.chat !== "hosted") return 0;
  const at = new Date();
  const judgeCount = input.judgeCount ?? 3;
  const perJudge = calculateCostMicros({
    catalog: input.catalog,
    provider: input.chat.provider ?? "unknown",
    model: input.chat.model,
    usageOperation: "chat_completion",
    at,
    inputTokens: 800,
    outputTokens: 150,
  }).costMicros;
  return perJudge * judgeCount;
}

/**
 * Reserve estimated cost for an offline/online eval job before provider calls.
 * Throws UsageLimitExceededError when the account cannot afford the estimate.
 * Returns null when enforcement is off (shadow/off) — still meters on finish when enabled.
 */
export async function beginEvalUsageReservation(input: {
  account: HostingAccount;
  assistantId: string;
  requestId: string;
  kind: "offline" | "online";
  chat: import("@chatai/ai").ChatConfig;
  embedding: import("@chatai/ai").EmbeddingConfig;
  billing: AssistantBillingModes;
  message: string;
  queryExpansionEnabled?: boolean;
  rerankEnabled?: boolean;
  verifyCitationsEnabled?: boolean;
  hasCohereKey?: boolean;
  catalog?: ModelPricingRow[];
}): Promise<UsageGateReservation | null> {
  if (!isUsageEnforcementEnabled()) {
    return null;
  }

  const catalog = await resolveCatalog(input.catalog);
  let estimateMicros = estimateJudgeCallsMicros({
    catalog,
    chat: input.chat,
    billing: input.billing,
  });

  if (input.kind === "offline") {
    const chatEstimate = estimateChatRequestCostMicros({
      catalog,
      chat: input.chat,
      embedding: input.embedding,
      billing: input.billing,
      message: input.message,
      historyChars: 0,
      queryExpansionEnabled: Boolean(input.queryExpansionEnabled),
      rerankEnabled: Boolean(input.rerankEnabled),
      verifyCitationsEnabled: Boolean(input.verifyCitationsEnabled),
      hasCohereKey: Boolean(input.hasCohereKey),
      maxOutputTokens: env.HOSTED_USAGE_MAX_OUTPUT_TOKENS,
    });
    estimateMicros += chatEstimate.estimateMicros;
  }

  // Always reserve at least $0.0001 hosted when any hosted billing mode is active,
  // so concurrent jobs still serialize against the ceiling.
  if (
    estimateMicros <= 0 &&
    (input.billing.chat === "hosted" ||
      input.billing.embedding === "hosted" ||
      input.billing.rerank === "hosted")
  ) {
    estimateMicros = 100;
  }

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
    operation: "chat_completion",
    provider: input.chat.provider ?? "unknown",
    model: input.chat.model,
    reservedMicros: reserved.estimateMicros,
    periodStart: balance.periodStart,
    metadata: {
      source: "eval",
      worker: "eval",
      evalKind: input.kind,
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

export async function finishEvalUsageReservation(input: {
  reservation: UsageGateReservation | null;
  accountId: string;
  assistantId: string;
  requestId: string;
  records: ProviderUsageRecord[];
  billing: AssistantBillingModes;
  catalog?: ModelPricingRow[];
  failed?: boolean;
}): Promise<void> {
  await finishChatUsageReservation({
    ...input,
    source: "eval",
  });
}

/**
 * Reserve a Key-facts/Purpose suggestion job (owner-triggered or a capped Knowledge
 * refresh): a few query embeddings plus one JSON generation call. Throws
 * UsageLimitExceededError when the account cannot afford it.
 */
export async function beginProfileUsageReservation(input: {
  account: HostingAccount;
  assistantId: string;
  requestId: string;
  chat: import("@chatai/ai").ChatConfig;
  embedding: EmbeddingConfig;
  billing: AssistantBillingModes;
  catalog?: ModelPricingRow[];
}): Promise<UsageGateReservation | null> {
  if (!isUsageEnforcementEnabled()) return null;
  const catalog = await resolveCatalog(input.catalog);
  const at = new Date();
  const chatMicros = calculateCostMicros({
    catalog,
    provider: input.chat.provider ?? "openai",
    model: input.chat.model,
    usageOperation: "chat_completion",
    at,
    inputTokens: 4_000,
    outputTokens: 1_500,
  }).costMicros;
  const embeddingMicros = calculateCostMicros({
    catalog,
    provider: input.embedding.provider ?? "openai",
    model: input.embedding.model,
    usageOperation: "embedding",
    at,
    totalTokens: 200,
  }).costMicros;
  let estimateMicros =
    (input.billing.chat === "hosted" ? chatMicros : 0) +
    (input.billing.embedding === "hosted" ? embeddingMicros : 0);
  if (estimateMicros <= 0 && (input.billing.chat === "hosted" || input.billing.embedding === "hosted")) {
    estimateMicros = 100;
  }

  const balance = await getOrCreateUsagePeriodBalance(input.account);
  if (!(await assertRequestCapAllows(input.account, balance.requestCount))) {
    throw new UsageLimitExceededError();
  }
  const reserved = await reserveUsage({ accountId: input.account.id, periodStart: balance.periodStart, estimateMicros });
  if (!reserved.ok) throw new UsageLimitExceededError();

  const reservationEventId = await createReservationEvent({
    accountId: input.account.id,
    assistantId: input.assistantId,
    requestId: input.requestId,
    operation: "chat_completion",
    provider: input.chat.provider ?? "unknown",
    model: input.chat.model,
    reservedMicros: reserved.estimateMicros,
    periodStart: balance.periodStart,
    metadata: { source: "ingest", worker: "profile" },
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

export async function finishProfileUsageReservation(input: {
  reservation: UsageGateReservation | null;
  accountId: string;
  assistantId: string;
  requestId: string;
  records: ProviderUsageRecord[];
  billing: AssistantBillingModes;
  failed?: boolean;
}): Promise<void> {
  await finishChatUsageReservation({ ...input, source: "ingest" });
}

export async function abortEvalUsageReservation(
  reservation: UsageGateReservation | null,
): Promise<void> {
  await abortChatUsageReservation(reservation);
}
