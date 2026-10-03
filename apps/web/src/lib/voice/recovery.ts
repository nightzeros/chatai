import { and, eq, isNull, lt, or, voiceSessions } from "@chatai/database";
import type { RealtimeVoiceProvider } from "@chatai/voice";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

import {
  createVoiceProvider,
  resolveVoiceProviderCredentials,
  resolveVoiceProviderKind,
} from "./credentials";
import { VOICE_RUNTIME_MAX_MS } from "./lifecycle";
import { settleVoiceUsage, type VoiceSettlementResult } from "./metering";
import { logVoiceEvent } from "./observability";
import { voiceRuntimeOwner } from "./runtime-instance";
import { getVoiceRuntime, listVoiceRuntimes } from "./session-runtime";
import { endProviderSession, type ProviderEndOutcome } from "./termination";

/** A live owner checkpoints every 10 s; 45 s of silence means the owner is gone. */
export const ORPHAN_CHECKPOINT_STALE_MS = 45 * 1000;
const ORPHAN_MAX_AGE_GRACE_MS = 5 * 60 * 1000;
/** A recovery claim older than this is considered abandoned (its process died too). */
const RECOVERY_CLAIM_TTL_MS = 2 * 60 * 1000;
const RECOVERY_BATCH = 20;

/**
 * An open row owned by another process that may still be running it (another host,
 * or a same-host pid that is alive) with a fresh checkpoint. V1 runs one Voice
 * replica or sticky routing, so such a request was misrouted: answer 421, never act.
 * A dead same-host owner (restart) is not protected: it is an orphan at once.
 */
export function ownedByLiveForeignRuntime(
  row: { meteringStatus: string; runtimeInstanceId: string | null; usageCheckpointAt: Date | null },
  now: number = Date.now(),
): boolean {
  return (
    row.meteringStatus === "open" &&
    row.runtimeInstanceId !== null &&
    voiceRuntimeOwner(row.runtimeInstanceId) === "unknown" &&
    row.usageCheckpointAt !== null &&
    now - row.usageCheckpointAt.getTime() < ORPHAN_CHECKPOINT_STALE_MS
  );
}

export type VoiceRecoveryOutcome = {
  sessionId: string;
  path: "provider_final" | "checkpoint" | "never_created" | "skipped";
  settlement: VoiceSettlementResult | null;
};

export type VoiceRecoveryTrigger = "sweep" | "heartbeat";

type ProviderFactory = () => Promise<RealtimeVoiceProvider | null>;

async function defaultProviderFactory(): Promise<RealtimeVoiceProvider | null> {
  const kind = resolveVoiceProviderKind(env.VOICE_PROVIDER);
  const credentials = kind === "gpt-live" ? resolveVoiceProviderCredentials() : null;
  if (kind === "gpt-live" && !credentials) return null;
  return createVoiceProvider({ kind, credentials });
}

/** Conditional claim: exactly one recovery attach per orphan, across processes. */
async function claimRecovery(sessionId: string, now: Date): Promise<boolean> {
  const claimExpired = new Date(now.getTime() - RECOVERY_CLAIM_TTL_MS);
  const claimed = await db()
    .update(voiceSessions)
    .set({ recoveryClaimedAt: now })
    .where(
      and(
        eq(voiceSessions.id, sessionId),
        eq(voiceSessions.meteringStatus, "open"),
        or(isNull(voiceSessions.recoveryClaimedAt), lt(voiceSessions.recoveryClaimedAt, claimExpired)),
      ),
    )
    .returning({ id: voiceSessions.id });
  return claimed.length > 0;
}

export type RecoverableVoiceRow = {
  id: string;
  providerSessionId: string | null;
  usageCheckpointAt: Date | null;
};

/**
 * Settle one orphaned session (its runtime is gone). Server-authoritative end:
 * attach the sideband → HTTP hangup → provider-final usage from session.closed;
 * if that is not possible (session already over, provider unreachable), the hangup
 * still ends any live provider session and usage settles from the checkpoint.
 * The settlement claim makes this safe to race with any other exit path.
 */
export async function recoverOrphanedVoiceSession(
  row: RecoverableVoiceRow,
  opts: {
    trigger: VoiceRecoveryTrigger;
    now?: Date;
    provider?: RealtimeVoiceProvider | null;
    providerFactory?: ProviderFactory;
  },
): Promise<VoiceRecoveryOutcome> {
  const now = opts.now ?? new Date();
  if (getVoiceRuntime(row.id) || !(await claimRecovery(row.id, now))) {
    return { sessionId: row.id, path: "skipped", settlement: null };
  }

  if (!row.providerSessionId) {
    const settlement = await settleVoiceUsage({
      sessionId: row.id,
      measurement: "none",
      providerSeconds: 0,
      endedAt: row.usageCheckpointAt ?? now,
      finalizeRow: { status: "failed", errorCode: "runtime_lost" },
      now,
    });
    logRecovery(row.id, opts.trigger, "never_created", null);
    return { sessionId: row.id, path: "never_created", settlement };
  }

  let ended: ProviderEndOutcome | null = null;
  try {
    const provider =
      opts.provider !== undefined
        ? opts.provider
        : await (opts.providerFactory ?? defaultProviderFactory)();
    if (provider) {
      ended = await endProviderSession({
        provider,
        providerSessionId: row.providerSessionId,
        channel: null,
        reattach: true,
      });
    }
  } catch {
    ended = null;
  }

  const finalSeconds = ended?.finalUsageSeconds ?? null;
  const settlement =
    finalSeconds != null
      ? await settleVoiceUsage({
          sessionId: row.id,
          measurement: "provider_final",
          providerSeconds: finalSeconds,
          endedAt: now,
          finalizeRow: { status: "ended", errorCode: "runtime_lost" },
          now,
        })
      : await settleVoiceUsage({
          sessionId: row.id,
          measurement: "provider_checkpoint",
          providerSeconds: 0,
          endedAt: row.usageCheckpointAt ?? now,
          finalizeRow: { status: "failed", errorCode: "runtime_lost" },
          now,
        });
  const path = finalSeconds != null ? "provider_final" : "checkpoint";
  logRecovery(row.id, opts.trigger, path, ended);
  return { sessionId: row.id, path, settlement };
}

function logRecovery(
  sessionId: string,
  trigger: VoiceRecoveryTrigger,
  path: VoiceRecoveryOutcome["path"],
  ended: ProviderEndOutcome | null,
): void {
  logVoiceEvent("recovery.outcome", {
    sessionId,
    trigger,
    path,
    hangup: ended?.hangup ?? null,
    observed: ended?.observed ?? false,
    alreadyGone: ended?.alreadyGone ?? false,
  });
}

/**
 * Settle Voice sessions whose owning runtime is gone (process crash / restart).
 * Candidates: `open` rows not live in this process whose checkpoint heartbeat
 * stopped, or that outlived the runtime cap.
 */
export async function recoverOrphanedVoiceSessions(opts?: {
  now?: Date;
  providerFactory?: ProviderFactory;
}): Promise<VoiceRecoveryOutcome[]> {
  const now = opts?.now ?? new Date();
  const staleBefore = new Date(now.getTime() - ORPHAN_CHECKPOINT_STALE_MS);
  const expiredBefore = new Date(now.getTime() - VOICE_RUNTIME_MAX_MS - ORPHAN_MAX_AGE_GRACE_MS);

  const rows = await db()
    .select({
      id: voiceSessions.id,
      providerSessionId: voiceSessions.providerSessionId,
      usageCheckpointAt: voiceSessions.usageCheckpointAt,
    })
    .from(voiceSessions)
    .where(
      and(
        eq(voiceSessions.meteringStatus, "open"),
        or(
          lt(voiceSessions.usageCheckpointAt, staleBefore),
          and(isNull(voiceSessions.usageCheckpointAt), lt(voiceSessions.createdAt, staleBefore)),
          lt(voiceSessions.startedAt, expiredBefore),
        ),
      ),
    )
    .limit(RECOVERY_BATCH);

  const live = new Set(listVoiceRuntimes().map((session) => session.sessionId));
  const candidates = rows.filter((row) => !live.has(row.id));
  if (candidates.length === 0) return [];

  let provider: RealtimeVoiceProvider | null | undefined;
  const outcomes: VoiceRecoveryOutcome[] = [];
  for (const row of candidates) {
    if (row.providerSessionId && provider === undefined) {
      provider = await (opts?.providerFactory ?? defaultProviderFactory)().catch(() => null);
    }
    outcomes.push(
      await recoverOrphanedVoiceSession(row, { trigger: "sweep", now, provider: provider ?? null }),
    );
  }

  const settled = outcomes.filter((outcome) => outcome.settlement).length;
  if (settled > 0) console.info("[voice] recovery.settled", { count: settled });
  return outcomes;
}

/**
 * Before an assistant (and, by cascade, its voice_sessions rows) is deleted: end its
 * live sessions and settle any open rows, so no grant is stranded and provider cost
 * reaches the ledger (ledger rows outlive the assistant with assistant_id = null).
 */
export async function endVoiceSessionsForAssistant(assistantId: string): Promise<void> {
  const { terminateVoiceSession } = await import("./lifecycle");
  const live = listVoiceRuntimes().filter((session) => session.assistantId === assistantId);
  await Promise.all(
    live.map((session) =>
      terminateVoiceSession(session, {
        reason: "close_requested",
        requestProviderClose: true,
        errorCode: "assistant_deleted",
      }).catch(() => undefined),
    ),
  );

  const open = await db()
    .select({ id: voiceSessions.id, usageCheckpointAt: voiceSessions.usageCheckpointAt })
    .from(voiceSessions)
    .where(and(eq(voiceSessions.assistantId, assistantId), eq(voiceSessions.meteringStatus, "open")));
  for (const row of open) {
    await settleVoiceUsage({
      sessionId: row.id,
      measurement: "provider_checkpoint",
      providerSeconds: 0,
      endedAt: row.usageCheckpointAt ?? new Date(),
      finalizeRow: { status: "failed", errorCode: "assistant_deleted" },
    }).catch(() => undefined);
  }
}
