import { env } from "@/lib/env";

import { isVoiceSettlementDeferred, terminateVoiceSession } from "./lifecycle";
import { logVoiceEvent, logVoiceWarning } from "./observability";
import {
  observeRecordingFinalizations,
  pendingRecordingFinalizations,
  type RecordingFinishOutcome,
} from "./recording/service";
import { listVoiceRuntimes } from "./session-runtime";

/** Application drain bound; the platform stop grace must be at least ~15 s. */
export const VOICE_SHUTDOWN_GRACE_MS_DEFAULT = 8_000;
/**
 * Share of the grace kept for settlement writes and recording finalization: the
 * provider end (re-attach → hangup → `session.closed`) must finish before it.
 */
const PROVIDER_END_RESERVE_MS = 2_000;
/** Exit anyway if the drain itself misbehaves. */
const HARD_EXIT_MARGIN_MS = 1_000;

export type VoiceShutdownSignal = "SIGTERM" | "SIGINT";

/** Sanitized drain outcome: counts and durations only. */
export type VoiceDrainReport = {
  trigger: string;
  /** Live Voice runtimes when the drain began. */
  live: number;
  /** Mints still running when the drain began (each is refused and cleaned up). */
  mintsInFlight: number;
  /** Ended with provider-final usage (`session.closed` observed). */
  closedFinal: number;
  /** Ended with the checkpoint / lower-bound settlement. */
  estimated: number;
  /** Ended, but settlement failed: the row stays open and restart recovery settles it. */
  settlementDeferred: number;
  /** Terminations still running at the deadline (left to heartbeat / restart recovery). */
  timedOut: number;
  recordingsFinalized: number;
  /** Finished without a stored recording (no audio, deleted meanwhile, upload failed). */
  recordingsNotStored: number;
  /** Still finalizing at the deadline: the spool stays for crash recovery (`partial`). */
  recordingsPending: number;
  durationMs: number;
};

type ShutdownState = {
  draining: boolean;
  drain: Promise<VoiceDrainReport> | null;
  mints: Set<Promise<unknown>>;
  handlersInstalled: boolean;
};

const stateKey = "__chatai_voice_shutdown__";

function shutdownState(): ShutdownState {
  const g = globalThis as typeof globalThis & { [stateKey]?: ShutdownState };
  return (g[stateKey] ??= { draining: false, drain: null, mints: new Set(), handlersInstalled: false });
}

/** New Voice sessions are refused (neutral `voice_unavailable`) once this is true. */
export function isVoiceDraining(): boolean {
  return shutdownState().draining;
}

export class VoiceDrainingError extends Error {
  constructor() {
    super("voice_draining");
  }
}

/** Throws when draining; call immediately before any step that starts or registers a session. */
export function assertVoiceNotDraining(): void {
  if (isVoiceDraining()) throw new VoiceDrainingError();
}

/** Run a mint so a drain that starts meanwhile waits for its cleanup. */
export async function trackVoiceMint<T>(work: () => Promise<T>): Promise<T> {
  const { mints } = shutdownState();
  const running = work();
  mints.add(running);
  try {
    return await running;
  } finally {
    mints.delete(running);
  }
}

export function voiceShutdownGraceMs(): number {
  return env.VOICE_SHUTDOWN_GRACE_MS ?? VOICE_SHUTDOWN_GRACE_MS_DEFAULT;
}

/** Resolves true when `work` settles before the deadline. */
function beforeDeadline(work: Promise<unknown>, deadlineAt: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(0, deadlineAt - Date.now()));
    timer.unref?.();
    void work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

/**
 * Graceful Voice drain (SIGTERM / SIGINT). Idempotent: every caller gets the same
 * drain. Marks the runtime draining synchronously, ends each live session through
 * the normal termination path (bounded re-attach → hangup → `session.closed` →
 * exactly-once settlement), then waits for recording finalization, all within
 * `graceMs`. Past the bound it returns anyway: unfinished sessions and recordings
 * keep their crash-recovery semantics.
 */
export function drainVoiceRuntime(input: { trigger: string; graceMs?: number }): Promise<VoiceDrainReport> {
  const state = shutdownState();
  if (state.drain) return state.drain;
  state.draining = true;
  state.drain = runDrain(input.trigger, input.graceMs ?? voiceShutdownGraceMs());
  return state.drain;
}

async function runDrain(trigger: string, graceMs: number): Promise<VoiceDrainReport> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + graceMs;
  const providerDeadlineAt = startedAt + Math.max(graceMs - PROVIDER_END_RESERVE_MS, graceMs / 2);
  const state = shutdownState();
  const live = listVoiceRuntimes();
  const mints = [...state.mints];
  const report: VoiceDrainReport = {
    trigger,
    live: live.length,
    mintsInFlight: mints.length,
    closedFinal: 0,
    estimated: 0,
    settlementDeferred: 0,
    timedOut: 0,
    recordingsFinalized: 0,
    recordingsNotStored: 0,
    recordingsPending: 0,
    durationMs: 0,
  };
  logVoiceEvent("shutdown.begin", { trigger, live: live.length, mintsInFlight: mints.length, graceMs });

  const recordings = [...pendingRecordingFinalizations()];
  const stopObserving = observeRecordingFinalizations((work) => recordings.push(work));
  try {
    let unfinished = live.length;
    const terminations = live.map((session) => {
      session.endReason ??= "shutdown";
      return terminateVoiceSession(session, {
        reason: "close_requested",
        requestProviderClose: true,
        errorCode: "shutdown",
        deadlineAt: providerDeadlineAt,
      }).then(
        (result) => {
          unfinished -= 1;
          if (isVoiceSettlementDeferred(session)) report.settlementDeferred += 1;
          else if (result.usageFinalized) report.closedFinal += 1;
          else report.estimated += 1;
        },
        () => {
          unfinished -= 1;
          report.settlementDeferred += 1;
        },
      );
    });
    await beforeDeadline(Promise.allSettled([...terminations, ...mints]), deadlineAt);
    report.timedOut = unfinished;

    const outcomes = new Map<Promise<RecordingFinishOutcome>, RecordingFinishOutcome>();
    const tracked = recordings.map((work) => work.then((outcome) => void outcomes.set(work, outcome)));
    await beforeDeadline(Promise.allSettled(tracked), deadlineAt);
    for (const work of recordings) {
      const outcome = outcomes.get(work);
      if (outcome === undefined) report.recordingsPending += 1;
      else if (outcome === "ready") report.recordingsFinalized += 1;
      else report.recordingsNotStored += 1;
    }
    // Sessions whose termination never reached the recorder: spool left for recovery.
    report.recordingsPending += live.filter((session) => session.recording).length;
  } catch (error) {
    logVoiceWarning("shutdown.drain_error", { error: error instanceof Error ? error.name : "unknown" });
  } finally {
    stopObserving();
  }

  report.durationMs = Date.now() - startedAt;
  const complete = report.timedOut === 0 && report.recordingsPending === 0 && report.settlementDeferred === 0;
  (complete ? logVoiceEvent : logVoiceWarning)("shutdown.drain", report);
  return report;
}

/**
 * Register SIGTERM / SIGINT once per process (Node runtime only). The first signal
 * drains and then exits; later signals are logged and change nothing. Requires
 * `NEXT_MANUAL_SIG_HANDLE=1`, otherwise Next.js exits on its own within ~50 ms.
 */
export function installVoiceShutdownHandlers(
  deps: {
    target?: { on(event: VoiceShutdownSignal, listener: () => void): unknown };
    exit?: (code: number) => void;
    graceMs?: number;
  } = {},
): boolean {
  const state = shutdownState();
  if (state.handlersInstalled) return false;
  state.handlersInstalled = true;

  const target = deps.target ?? process;
  const graceMs = deps.graceMs ?? voiceShutdownGraceMs();
  let exited = false;
  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    (deps.exit ?? ((c: number) => process.exit(c)))(code);
  };

  const onSignal = (signal: VoiceShutdownSignal) => {
    if (shutdownState().drain) {
      logVoiceEvent("shutdown.signal_repeated", { signal });
      return;
    }
    const hardStop = setTimeout(() => exit(0), graceMs + HARD_EXIT_MARGIN_MS);
    hardStop.unref?.();
    void drainVoiceRuntime({ trigger: signal, graceMs }).then(
      () => {
        clearTimeout(hardStop);
        exit(0);
      },
      () => exit(0),
    );
  };
  target.on("SIGTERM", () => onSignal("SIGTERM"));
  target.on("SIGINT", () => onSignal("SIGINT"));
  return true;
}

/** Tests only. */
export function resetVoiceShutdownForTests(): void {
  const g = globalThis as typeof globalThis & { [stateKey]?: ShutdownState };
  delete g[stateKey];
}
