import {
  and,
  count,
  eq,
  hostingAccounts,
  isNull,
  sql,
  usagePeriodBalances,
  voiceSessions,
  type ConversationSource,
  type VoiceMeteringMode,
} from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { HostingAccount } from "@/lib/hosting/accounts";
import { currentBillingPeriod } from "@/lib/hosting/period-anchor";
import { getOrCreateUsagePeriodBalance } from "@/lib/hosting/period-balance";
import { resolveAccountEntitlements } from "@/lib/hosting/plan-entitlements";

/** Normal reservation block; near the limit a grant shrinks to what remains. */
export const VOICE_GRANT_BLOCK_SECONDS = 300;
/** Admission needs at least this much remaining (below it a session is pointless). */
export const VOICE_ADMISSION_MIN_SECONDS = 30;

/** Serializes instance-wide concurrency admission across accounts. */
const VOICE_ADMISSION_LOCK_KEY = 7_311_002;

export type VoiceRefusalReason = "voice_minutes_exhausted" | "voice_concurrency_limit";

export type VoiceAdmission = {
  sessionId: string;
  accountId: string;
  mode: VoiceMeteringMode;
  quotaExempt: boolean;
  /** Grants are reserved against the balance and enforced by closing the session. */
  enforced: boolean;
  granted: number;
  periodStart: Date;
};

export type VoiceAdmissionResult =
  | { ok: true; admission: VoiceAdmission }
  | { ok: false; status: 402 | 429; reason: VoiceRefusalReason };

export function voiceMeteringMode(): VoiceMeteringMode {
  return env.HOSTED_USAGE_ENFORCEMENT;
}

export function isVoiceQuotaExempt(source: ConversationSource): boolean {
  return source === "playground" && env.VOICE_QUOTA_EXEMPT_PLAYGROUND;
}

/** Seconds a grant may add given a balance row; null limit = unlimited. */
export function grantableSeconds(balance: {
  voiceSecondsLimit: number | null;
  voiceSecondsConsumed: number;
  voiceSecondsReserved: number;
}): number {
  if (balance.voiceSecondsLimit == null) return VOICE_GRANT_BLOCK_SECONDS;
  const remaining =
    balance.voiceSecondsLimit - balance.voiceSecondsConsumed - balance.voiceSecondsReserved;
  return Math.max(0, Math.min(VOICE_GRANT_BLOCK_SECONDS, remaining));
}

/**
 * Admit a Voice session before the provider session is created, in one transaction:
 * account (+ instance) concurrency, then the initial (possibly partial) grant, then
 * the metering row itself, so concurrent mints can never over-admit or over-reserve.
 */
export async function admitVoiceSession(input: {
  sessionId: string;
  assistantId: string;
  account: HostingAccount;
  source: ConversationSource;
  visitorId: string | null;
  ephemeral: boolean;
  providerId: string;
  model: string;
  voiceId: string;
  now?: Date;
}): Promise<VoiceAdmissionResult> {
  const now = input.now ?? new Date();
  const mode = voiceMeteringMode();
  const quotaExempt = isVoiceQuotaExempt(input.source);
  const enforced = mode === "enforce" && !quotaExempt;
  const instanceCap = env.VOICE_MAX_CONCURRENT_SESSIONS ?? null;
  const accountCap =
    mode === "enforce"
      ? (await resolveAccountEntitlements(input.account)).maxConcurrentVoiceSessions
      : null;
  const balance = enforced ? await getOrCreateUsagePeriodBalance(input.account, now) : null;
  const periodStart =
    balance?.periodStart ?? currentBillingPeriod(input.account.periodAnchor, now).periodStart;

  return db().transaction(async (tx): Promise<VoiceAdmissionResult> => {
    if (instanceCap != null) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${VOICE_ADMISSION_LOCK_KEY})`);
    }
    await tx
      .select({ id: hostingAccounts.id })
      .from(hostingAccounts)
      .where(eq(hostingAccounts.id, input.account.id))
      .for("update");

    if (accountCap != null) {
      const [open] = await tx
        .select({ value: count() })
        .from(voiceSessions)
        .where(
          and(
            eq(voiceSessions.hostingAccountId, input.account.id),
            eq(voiceSessions.meteringStatus, "open"),
          ),
        );
      if (Number(open?.value ?? 0) >= accountCap) {
        return { ok: false, status: 429, reason: "voice_concurrency_limit" };
      }
    }
    if (instanceCap != null) {
      const [open] = await tx
        .select({ value: count() })
        .from(voiceSessions)
        .where(eq(voiceSessions.meteringStatus, "open"));
      if (Number(open?.value ?? 0) >= instanceCap) {
        return { ok: false, status: 429, reason: "voice_concurrency_limit" };
      }
    }

    let granted = 0;
    if (enforced && balance) {
      const [locked] = await tx
        .select()
        .from(usagePeriodBalances)
        .where(eq(usagePeriodBalances.id, balance.id))
        .for("update");
      granted = locked ? grantableSeconds(locked) : 0;
      if (granted < VOICE_ADMISSION_MIN_SECONDS) {
        return { ok: false, status: 402, reason: "voice_minutes_exhausted" };
      }
      await tx
        .update(usagePeriodBalances)
        .set({
          voiceSecondsReserved: sql`${usagePeriodBalances.voiceSecondsReserved} + ${granted}`,
          updatedAt: now,
        })
        .where(eq(usagePeriodBalances.id, balance.id));
    }

    await tx.insert(voiceSessions).values({
      id: input.sessionId,
      assistantId: input.assistantId,
      conversationId: null,
      visitorId: input.visitorId,
      source: input.source,
      provider: input.providerId,
      status: "connecting",
      ephemeral: input.ephemeral,
      model: input.model,
      voiceId: input.voiceId,
      startedAt: now,
      interruptCount: 0,
      meteringStatus: "open",
      meteringMode: mode,
      hostingAccountId: input.account.id,
      usagePeriodStart: periodStart,
      voiceSecondsGranted: granted,
      quotaExempt,
      usageCheckpointAt: now,
    });

    return {
      ok: true,
      admission: {
        sessionId: input.sessionId,
        accountId: input.account.id,
        mode,
        quotaExempt,
        enforced,
        granted,
        periodStart,
      },
    };
  });
}

/**
 * Undo an admission whose provider session was never created (mint failed early):
 * no meter, grant returned, row removed.
 */
export async function releaseVoiceAdmission(sessionId: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(voiceSessions)
      .where(
        and(
          eq(voiceSessions.id, sessionId),
          eq(voiceSessions.meteringStatus, "open"),
          isNull(voiceSessions.providerSessionId),
        ),
      )
      .for("update");
    if (!row) return;
    if (row.meteringMode === "enforce" && row.voiceSecondsGranted > 0 && row.hostingAccountId && row.usagePeriodStart) {
      await tx
        .update(usagePeriodBalances)
        .set({
          voiceSecondsReserved: sql`GREATEST(0, ${usagePeriodBalances.voiceSecondsReserved} - ${row.voiceSecondsGranted})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(usagePeriodBalances.accountId, row.hostingAccountId),
            eq(usagePeriodBalances.periodStart, row.usagePeriodStart),
          ),
        );
    }
    await tx.delete(voiceSessions).where(eq(voiceSessions.id, sessionId));
  });
}

/**
 * Reserve the next (possibly partial) block for a running session. Conditional on
 * the session still being open, so an extension can never land after settlement.
 * Returns the seconds added (0 = nothing left).
 */
export async function extendVoiceGrant(sessionId: string, now: Date = new Date()): Promise<number> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(voiceSessions)
      .where(and(eq(voiceSessions.id, sessionId), eq(voiceSessions.meteringStatus, "open")))
      .for("update");
    if (!row || row.meteringMode !== "enforce" || row.quotaExempt) return 0;
    if (!row.hostingAccountId || !row.usagePeriodStart) return 0;

    const [balance] = await tx
      .select()
      .from(usagePeriodBalances)
      .where(
        and(
          eq(usagePeriodBalances.accountId, row.hostingAccountId),
          eq(usagePeriodBalances.periodStart, row.usagePeriodStart),
        ),
      )
      .for("update");
    if (!balance) return 0;
    const added = grantableSeconds(balance);
    if (added <= 0) return 0;

    await tx
      .update(usagePeriodBalances)
      .set({
        voiceSecondsReserved: sql`${usagePeriodBalances.voiceSecondsReserved} + ${added}`,
        updatedAt: now,
      })
      .where(eq(usagePeriodBalances.id, balance.id));
    await tx
      .update(voiceSessions)
      .set({ voiceSecondsGranted: sql`${voiceSessions.voiceSecondsGranted} + ${added}` })
      .where(eq(voiceSessions.id, sessionId));
    return added;
  });
}
