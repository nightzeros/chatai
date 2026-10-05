import { createHash } from "node:crypto";

import { calculateCostMicros, type ModelPricingRow } from "@chatai/billing";
import {
  and,
  eq,
  sql,
  usageEvents,
  usagePeriodBalances,
  voiceSessions,
  type UsageEventMetadata,
  type VoiceMeteringStatus,
  type VoiceUsageMeasurement,
} from "@chatai/database";

import { db } from "@/lib/db";
import { resolvePricingCatalog } from "@/lib/hosting/pricing-catalog";
import { createId } from "@/lib/ids";

import { voiceRuntimeInstanceId } from "./runtime-instance";

/**
 * Voice usage metering.
 *
 * Two measurements per session, never mixed:
 * - customer Voice seconds (entitlement / quota, shown as minutes), and
 * - provider usage + cost (ledger row `usage_events.voice_realtime`, provider units).
 *
 * Settlement is a single transaction whose first statement claims the session
 * (`metering_status = 'open'` → terminal). Every exit path calls it; only the
 * first call has any effect.
 */

/** GPT-Live bills this much at WebRTC session creation, credited against runtime. */
export const PROVIDER_INIT_SECONDS = 15;
/** Checkpoint when usage advanced this much since the last durable write… */
export const CHECKPOINT_MIN_ADVANCE_SECONDS = 15;
/** …or this long passed (also the liveness heartbeat the recovery sweep relies on). */
export const CHECKPOINT_MAX_INTERVAL_MS = 10_000;

export type VoiceSettlementInput = {
  sessionId: string;
  measurement: VoiceUsageMeasurement;
  /** Latest provider cumulative usage known to the caller. */
  providerSeconds: number;
  endedAt?: Date;
  /** Media evidence observed in memory (the durable `connected_at` also counts). */
  connected?: boolean;
  /** Also finalize the lifecycle columns (recovery path, where no runtime exists). */
  finalizeRow?: { status: "ended" | "failed"; errorCode: string | null };
  now?: Date;
  catalog?: ModelPricingRow[];
};

export type VoiceSettlementResult = {
  sessionId: string;
  meteringStatus: Exclude<VoiceMeteringStatus, "open" | "legacy">;
  voiceSeconds: number;
  providerSeconds: number;
  providerCostMicros: number;
  usageEventId: string | null;
  anomaly: "wallclock_cap" | null;
};

export type VoiceSecondsComputation = {
  voiceSeconds: number;
  providerBillableSeconds: number;
  neverConnected: boolean;
  anomaly: "wallclock_cap" | null;
};

/**
 * Customer Voice seconds = min(ceil(provider seconds), ceil(wall clock) + init).
 * Wall clock is only a sanity bound; never-connected sessions count 0 (the provider
 * cost is still accounted from `providerBillableSeconds`).
 */
export function computeVoiceSeconds(input: {
  providerSeconds: number;
  startedAt: Date;
  endedAt: Date;
  connected: boolean;
  providerSessionCreated: boolean;
}): VoiceSecondsComputation {
  if (!input.providerSessionCreated) {
    return { voiceSeconds: 0, providerBillableSeconds: 0, neverConnected: true, anomaly: null };
  }
  const provider = Math.max(0, Math.ceil(input.providerSeconds));
  const providerBillableSeconds = Math.max(PROVIDER_INIT_SECONDS, provider);
  const neverConnected = !input.connected && provider <= PROVIDER_INIT_SECONDS;
  if (neverConnected) {
    return { voiceSeconds: 0, providerBillableSeconds, neverConnected, anomaly: null };
  }
  const wallclock = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()) / 1000;
  const cap = Math.ceil(wallclock) + PROVIDER_INIT_SECONDS;
  const capped = provider > cap;
  return {
    voiceSeconds: capped ? cap : provider,
    providerBillableSeconds,
    neverConnected,
    anomaly: capped ? "wallclock_cap" : null,
  };
}

/** Provider name used for pricing lookups (registry id → pricing catalog provider). */
export function pricingProviderFor(providerId: string): string {
  return providerId === "gpt-live" ? "openai" : providerId;
}

function hashVisitorId(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 16);
}

/**
 * Settle a session exactly once. Returns null when it was already settled (or never
 * metered); callers never need to know which exit path won.
 */
export async function settleVoiceUsage(
  input: VoiceSettlementInput,
): Promise<VoiceSettlementResult | null> {
  const [peek] = await db()
    .select({ meteringStatus: voiceSessions.meteringStatus })
    .from(voiceSessions)
    .where(eq(voiceSessions.id, input.sessionId))
    .limit(1);
  if (peek?.meteringStatus !== "open") return null;

  const catalog = await resolvePricingCatalog(input.catalog);
  const now = input.now ?? new Date();

  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(voiceSessions)
      .where(and(eq(voiceSessions.id, input.sessionId), eq(voiceSessions.meteringStatus, "open")))
      .for("update");
    if (!row) return null;

    const providerSeconds = Math.max(row.providerUsageSeconds, Math.ceil(input.providerSeconds));
    const endedAt = input.endedAt ?? row.endedAt ?? now;
    const computed = computeVoiceSeconds({
      providerSeconds,
      startedAt: row.startedAt,
      endedAt,
      connected: Boolean(input.connected) || row.connectedAt != null,
      providerSessionCreated: Boolean(row.providerSessionId),
    });
    const meteringStatus: VoiceSettlementResult["meteringStatus"] = computed.neverConnected
      ? "not_billable"
      : input.measurement === "provider_final"
        ? "settled"
        : "estimated";
    const measurement: VoiceUsageMeasurement =
      input.measurement === "provider_final" || providerSeconds > 0
        ? input.measurement
        : "none";
    const mode = row.meteringMode ?? "off";

    await tx
      .update(voiceSessions)
      .set({
        meteringStatus,
        voiceSeconds: computed.voiceSeconds,
        providerUsageSeconds: providerSeconds,
        billableSeconds: computed.providerBillableSeconds,
        usageMeasurement: measurement,
        usageSettledAt: now,
        usageCheckpointAt: now,
        updatedAt: now,
        ...(input.finalizeRow
          ? {
              status: input.finalizeRow.status,
              endedAt: row.endedAt ?? endedAt,
              durationMs: Math.max(0, endedAt.getTime() - row.startedAt.getTime()),
              errorCode: row.errorCode ?? input.finalizeRow.errorCode,
            }
          : {}),
      })
      .where(eq(voiceSessions.id, row.id));

    if (mode === "enforce" && row.hostingAccountId && row.usagePeriodStart) {
      const consumed = row.quotaExempt ? 0 : computed.voiceSeconds;
      await tx
        .update(usagePeriodBalances)
        .set({
          voiceSecondsReserved: sql`GREATEST(0, ${usagePeriodBalances.voiceSecondsReserved} - ${row.voiceSecondsGranted})`,
          voiceSecondsConsumed: sql`${usagePeriodBalances.voiceSecondsConsumed} + ${consumed}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(usagePeriodBalances.accountId, row.hostingAccountId),
            eq(usagePeriodBalances.periodStart, row.usagePeriodStart),
          ),
        );
    }

    let usageEventId: string | null = null;
    let providerCostMicros = 0;
    if (mode !== "off" && row.hostingAccountId && computed.providerBillableSeconds > 0) {
      const provider = pricingProviderFor(row.provider);
      const { costMicros, pricingSnapshot } = calculateCostMicros({
        catalog,
        provider,
        model: row.model,
        usageOperation: "voice_realtime",
        at: row.startedAt,
        units: computed.providerBillableSeconds,
      });
      providerCostMicros = costMicros;
      // Operational metering only: no transcript, audio, conversation link or raw visitor id.
      const metadata: UsageEventMetadata = {
        source: row.source,
        providerUnit: "second",
        voiceSeconds: computed.voiceSeconds,
        measurement,
        meteringStatus,
        ...(row.quotaExempt ? { quotaExempt: true } : {}),
        ...(computed.anomaly ? { anomaly: computed.anomaly } : {}),
        ...(row.visitorId && !row.ephemeral ? { visitorIdHash: hashVisitorId(row.visitorId) } : {}),
        ...(row.usagePeriodStart ? { periodStart: row.usagePeriodStart.toISOString() } : {}),
      };
      const id = createId();
      const inserted = await tx
        .insert(usageEvents)
        .values({
          id,
          accountId: row.hostingAccountId,
          assistantId: row.assistantId,
          requestId: row.id,
          idempotencyKey: `voice_realtime:${row.id}`,
          operation: "voice_realtime",
          provider,
          model: row.model,
          billingMode: "hosted",
          units: computed.providerBillableSeconds,
          reservedCostMicros: 0,
          finalCostMicros: costMicros,
          pricingSnapshot,
          status: mode === "enforce" ? "completed" : "shadow",
          metadata,
          createdAt: now,
          completedAt: now,
        })
        .onConflictDoNothing({ target: usageEvents.idempotencyKey })
        .returning({ id: usageEvents.id });
      if (inserted[0]) {
        usageEventId = inserted[0].id;
        await tx
          .update(voiceSessions)
          .set({ usageEventId })
          .where(eq(voiceSessions.id, row.id));
      }
    }

    return {
      sessionId: row.id,
      meteringStatus,
      voiceSeconds: computed.voiceSeconds,
      providerSeconds: computed.providerBillableSeconds,
      providerCostMicros,
      usageEventId,
      anomaly: computed.anomaly,
    };
  });
}

/** Durable monotonic checkpoint; also the liveness heartbeat for the recovery sweep. */
export async function checkpointVoiceUsage(
  sessionId: string,
  providerSeconds: number,
  now: Date = new Date(),
): Promise<void> {
  await db()
    .update(voiceSessions)
    .set({
      providerUsageSeconds: sql`GREATEST(${voiceSessions.providerUsageSeconds}, ${Math.max(0, Math.ceil(providerSeconds))})`,
      usageCheckpointAt: now,
    })
    .where(and(eq(voiceSessions.id, sessionId), eq(voiceSessions.meteringStatus, "open")));
}

/** First media evidence; distinguishes connected sessions from never-connected mints. */
export async function markVoiceConnected(sessionId: string, at: Date): Promise<void> {
  await db()
    .update(voiceSessions)
    .set({ connectedAt: at })
    .where(
      and(
        eq(voiceSessions.id, sessionId),
        eq(voiceSessions.meteringStatus, "open"),
        sql`${voiceSessions.connectedAt} IS NULL`,
      ),
    );
}

/** Provider session exists (provider billing started); the row becomes recoverable. */
export async function markVoiceProviderCreated(input: {
  sessionId: string;
  providerSessionId: string;
  startedAt: Date;
}): Promise<void> {
  await db()
    .update(voiceSessions)
    .set({
      providerSessionId: input.providerSessionId,
      startedAt: input.startedAt,
      usageCheckpointAt: input.startedAt,
      runtimeInstanceId: voiceRuntimeInstanceId(),
      updatedAt: input.startedAt,
    })
    .where(eq(voiceSessions.id, input.sessionId));
}
