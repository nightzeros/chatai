import type { ConversationSource } from "@chatai/database";
import type { SessionCloseReason } from "@chatai/voice";

import { finalizeAnsweredTurns, settleLiveExchanges } from "./delegation-orchestrator";
import { stopVoiceMeter } from "./enforcement";
import { settleVoiceUsage } from "./metering";
import { logVoiceEvent } from "./observability";
import { finalizeVoiceSessionRow } from "./persist";
import { finishVoiceRecording } from "./recording/service";
import {
  abortVoiceTurns,
  discardConversationalBuffers,
  listVoiceRuntimes,
  unregisterVoiceRuntime,
  type VoiceEndReason,
  type VoiceRuntimeSession,
} from "./session-runtime";
import { endProviderSession } from "./termination";
import { endVoiceGate } from "./turn-gate";

/** Hard cap for an in-memory voice runtime (client vanished without end/close). */
export const VOICE_RUNTIME_MAX_MS = 60 * 60 * 1000;

/** How long a finished session's result stays answerable to a late `/end`. */
const ENDED_TOMBSTONE_MS = 5 * 60 * 1000;

export type TerminateVoiceResult = {
  sessionId: string;
  status: VoiceRuntimeSession["status"];
  billableSeconds: number;
  usageFinalized: boolean;
  usageIncomplete: boolean;
  ephemeral: boolean;
  closeReason: string;
  /** ChatAI ended the session itself (usage, superseded, idle, lost control, cap). */
  endReason: VoiceEndReason | null;
};

export type EndedVoiceSession = {
  result: TerminateVoiceResult;
  assistantId: string;
  visitorId: string | null;
  source: ConversationSource;
};

const endedKey = "__chatai_voice_ended_sessions__";

function endedSessions(): Map<string, EndedVoiceSession & { expiresAt: number }> {
  const g = globalThis as typeof globalThis & {
    [endedKey]?: Map<string, EndedVoiceSession & { expiresAt: number }>;
  };
  if (!g[endedKey]) g[endedKey] = new Map();
  return g[endedKey];
}

function rememberEnded(session: VoiceRuntimeSession, result: TerminateVoiceResult): void {
  const map = endedSessions();
  const now = Date.now();
  for (const [id, entry] of map) {
    if (entry.expiresAt <= now) map.delete(id);
  }
  map.set(session.sessionId, {
    result,
    assistantId: session.assistantId,
    visitorId: session.visitorId,
    source: session.source,
    expiresAt: now + ENDED_TOMBSTONE_MS,
  });
}

/** End reason as seen by public widget visitors: never reveals usage, quota or internals. */
export type PublicVoiceEndReason =
  | "voice_unavailable"
  | "superseded"
  | "idle"
  | "disconnected"
  | "max_duration";

/** Widget mapping: usage and control-plane causes collapse into neutral reasons. */
export function publicVoiceEndReason(reason: VoiceEndReason | null): PublicVoiceEndReason | null {
  switch (reason) {
    case null:
      return null;
    case "usage_limit":
      return "voice_unavailable";
    case "heartbeat_lost":
    case "control_lost":
    case "shutdown":
      return "disconnected";
    default:
      return reason;
  }
}

/**
 * Widget visitors get a neutral end reason; owners (playground) and API-key
 * integrations keep the administrative one.
 */
export function publicEndResult(
  result: TerminateVoiceResult,
  source: ConversationSource,
): Omit<TerminateVoiceResult, "endReason"> & { endReason: VoiceEndReason | PublicVoiceEndReason | null } {
  if (source !== "widget") return result;
  return { ...result, endReason: publicVoiceEndReason(result.endReason) };
}

/** Result of a recently terminated session (metadata only, no conversational content). */
export function getEndedVoiceSession(sessionId: string): EndedVoiceSession | undefined {
  const entry = endedSessions().get(sessionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    endedSessions().delete(sessionId);
    return undefined;
  }
  return entry;
}

export function clearEndedVoiceSessionsForTests(): void {
  endedSessions().clear();
}

/**
 * Server-authoritative provider end for a live runtime: bounded re-attach →
 * HTTP hangup → `session.closed` final usage. Never waits unboundedly for usage.
 */
async function closeRuntimeProviderSession(
  session: VoiceRuntimeSession,
  reattach: boolean,
  deadlineAt: number | undefined,
): Promise<void> {
  session.status = "ending";
  abortVoiceTurns(session, "session_closed");

  if (!session.usageFinalized) {
    const outcome = await endProviderSession({
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      channel: session.channel,
      reattach,
      deadlineAt,
    }).catch(() => null);
    // The supervisor may already have applied session.closed; otherwise take it here.
    if (!session.usageFinalized && outcome?.finalUsageSeconds != null) {
      session.usageSeconds = outcome.finalUsageSeconds;
      session.usageFinalized = true;
    }
    logVoiceEvent("termination.provider", {
      sessionId: session.sessionId,
      hangup: outcome?.hangup ?? "failed",
      observed: outcome?.observed ?? false,
      sidebandClose: outcome?.sidebandClose ?? false,
      alreadyGone: outcome?.alreadyGone ?? false,
      usageFinalized: session.usageFinalized,
    });
  }

  session.usageIncomplete = !session.usageFinalized;
  session.status = session.usageIncomplete ? "failed" : "ended";
  session.endedAt = session.endedAt ?? new Date();
  session.unsubscribe?.();
  session.unsubscribe = null;
  session.channel = null;
}

const settlementDeferred = new WeakSet<VoiceRuntimeSession>();

/** Termination could not settle (e.g. database error): the row is left `open` for recovery. */
export function isVoiceSettlementDeferred(session: VoiceRuntimeSession): boolean {
  return settlementDeferred.has(session);
}

/**
 * Single termination path for every exit:
 * - client end request       → requestProviderClose=true
 * - provider session.closed  → requestProviderClose=false (already closed)
 * - sideband lost for good   → requestProviderClose=true, reattach=false (hangup only)
 * - idle / heartbeat lost    → requestProviderClose=true
 * - runtime cap reached      → requestProviderClose=true (endReason max_duration)
 * - Voice time used up       → requestProviderClose=true (endReason usage_limit)
 * - superseded by a new mint → requestProviderClose=true (endReason superseded)
 * - graceful shutdown        → requestProviderClose=true (endReason shutdown, drain deadline)
 *
 * Always: finalize operational metadata, settle usage exactly once, wipe
 * conversational buffers, unregister.
 */
export async function terminateVoiceSession(
  session: VoiceRuntimeSession,
  input: {
    reason: SessionCloseReason;
    requestProviderClose: boolean;
    errorCode?: string | null;
    /** Try a bounded sideband re-attach first so final usage can be observed (default true). */
    reattach?: boolean;
    /** Wall-clock bound on the provider end (graceful shutdown); settlement follows either way. */
    deadlineAt?: number;
  },
): Promise<TerminateVoiceResult> {
  if (session.terminating) {
    return session.terminating;
  }

  const run = (async (): Promise<TerminateVoiceResult> => {
    // Yield first so `session.terminating` is set before any work: closing the
    // provider emits session.closed synchronously, which re-enters this function.
    await Promise.resolve();
    // Nothing the model says while the call is ending is approved.
    endVoiceGate(session);
    if (session.ttlTimer) {
      clearTimeout(session.ttlTimer);
      session.ttlTimer = null;
    }
    if (session.supervision?.timer) {
      clearInterval(session.supervision.timer);
      session.supervision.timer = null;
    }
    stopVoiceMeter(session);

    const closeReason: string = input.reason;
    if (input.requestProviderClose) {
      await closeRuntimeProviderSession(session, input.reattach ?? true, input.deadlineAt);
    } else {
      session.unsubscribe?.();
      session.unsubscribe = null;
      session.channel = null;
      session.endedAt = session.endedAt ?? new Date();
      if (!session.usageFinalized) session.usageIncomplete = true;
      session.status = session.usageIncomplete ? "failed" : "ended";
      abortVoiceTurns(session, "session_closed");
    }

    // Background mux + upload; `/end` never waits for the recording.
    void finishVoiceRecording(session);

    const errorCode =
      input.errorCode ?? (session.usageIncomplete ? "usage_unconfirmed" : null);

    try {
      // Record what was actually spoken / interrupted, and turns GPT-Live answered
      // itself, before the wipe (persisted only for durable transcripts).
      await finalizeAnsweredTurns(session);
      await settleLiveExchanges(session, { final: true });
    } catch {
      // Best-effort; never blocks termination.
    }

    try {
      await finalizeVoiceSessionRow(session, {
        status: session.usageIncomplete ? "failed" : "ended",
        billableSeconds: session.usageSeconds,
        usageFinalized: session.usageFinalized,
        errorCode,
      });
    } catch {
      // Metadata finalize failure must not keep conversational state alive.
    }

    try {
      // Provider-final when session.closed confirmed usage; otherwise the durable
      // checkpoint (raised to the latest in-memory snapshot) is an estimate.
      await settleVoiceUsage({
        sessionId: session.sessionId,
        measurement: session.usageFinalized ? "provider_final" : "provider_checkpoint",
        providerSeconds: session.usageSeconds,
        endedAt: session.endedAt ?? new Date(),
        connected: Boolean(session.metering?.connectedAt),
      });
    } catch (error) {
      // The row stays `open`; the recovery sweep settles it from the checkpoint.
      settlementDeferred.add(session);
      console.error("[voice] usage settlement failed", {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      discardConversationalBuffers(session);
      unregisterVoiceRuntime(session.sessionId);
    }

    const result: TerminateVoiceResult = {
      sessionId: session.sessionId,
      status: session.status,
      billableSeconds: session.usageSeconds,
      usageFinalized: session.usageFinalized,
      usageIncomplete: session.usageIncomplete,
      ephemeral: session.ephemeral,
      closeReason,
      endReason: session.endReason ?? null,
    };
    logVoiceEvent("session.terminated", {
      sessionId: session.sessionId,
      source: session.source,
      closeReason,
      endReason: result.endReason,
      errorCode,
      usageFinalized: result.usageFinalized,
      billableSeconds: result.billableSeconds,
    });
    rememberEnded(session, result);
    return result;
  })();

  session.terminating = run;
  return run;
}

/**
 * One active widget session per visitor per assistant: a new mint ends (and settles)
 * the visitor's previous runtime before admission counts concurrency.
 */
export async function supersedeVisitorVoiceSessions(input: {
  assistantId: string;
  visitorId: string | null;
  source: ConversationSource;
}): Promise<number> {
  if (input.source !== "widget" || !input.visitorId) return 0;
  const previous = listVoiceRuntimes().filter(
    (session) =>
      session.assistantId === input.assistantId &&
      session.visitorId === input.visitorId &&
      session.source === "widget" &&
      !session.terminating,
  );
  await Promise.all(
    previous.map((session) => {
      session.endReason = "superseded";
      return terminateVoiceSession(session, {
        reason: "close_requested",
        requestProviderClose: true,
        errorCode: "superseded",
      }).catch(() => undefined);
    }),
  );
  return previous.length;
}

/** Arm the runtime cap so abandoned or overlong sessions are closed and wiped. */
export function armVoiceRuntimeTtl(
  session: VoiceRuntimeSession,
  maxMs: number = VOICE_RUNTIME_MAX_MS,
): void {
  if (session.ttlTimer) clearTimeout(session.ttlTimer);
  const timer = setTimeout(() => {
    session.endReason ??= "max_duration";
    void terminateVoiceSession(session, {
      reason: "expired",
      requestProviderClose: true,
      errorCode: "runtime_ttl_expired",
    });
  }, maxMs);
  timer.unref?.();
  session.ttlTimer = timer;
}
