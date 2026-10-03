import {
  ControlAttachError,
  type RealtimeVoiceProvider,
  type SessionCloseReason,
  type VoiceControlChannel,
} from "@chatai/voice";

export const VOICE_TERMINATION_DEFAULTS = {
  /** Bound on one sideband (re-)attach made only to observe final usage. */
  attachTimeoutMs: 5_000,
  /** Bound on waiting for `session.closed` after the hangup was accepted. */
  closedWaitMs: 5_000,
};

let settings = VOICE_TERMINATION_DEFAULTS;

export function setVoiceTerminationSettingsForTests(
  overrides: Partial<typeof VOICE_TERMINATION_DEFAULTS> | null,
): void {
  settings = overrides ? { ...VOICE_TERMINATION_DEFAULTS, ...overrides } : VOICE_TERMINATION_DEFAULTS;
}

export type ProviderEndOutcome = {
  /** Provider-final cumulative usage from `session.closed`; null when not observed. */
  finalUsageSeconds: number | null;
  closedReason: SessionCloseReason | null;
  /** A sideband was attached while the hangup ran. */
  observed: boolean;
  hangup: "ok" | "not_found" | "failed" | "unsupported";
  /** Sideband `session.close` fallback was used (hangup failed or is unsupported). */
  sidebandClose: boolean;
  /** The provider reported the session gone before the hangup (404 attach or hangup). */
  alreadyGone: boolean;
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), Math.max(0, ms));
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isConnected(channel: VoiceControlChannel): boolean {
  return channel.isConnected ? channel.isConnected() : true;
}

/**
 * Server-authoritative end of a provider session, bounded at every step:
 * 1. make sure a sideband observes the session (re-attach, or attach for recovery);
 * 2. HTTP hangup (works without a sideband);
 * 3. consume `session.closed` final usage when it arrives.
 * The caller settles exactly once from the outcome: provider-final when
 * `finalUsageSeconds` is set, otherwise the checkpoint / lower-bound path.
 */
export async function endProviderSession(input: {
  provider: RealtimeVoiceProvider;
  providerSessionId: string;
  channel: VoiceControlChannel | null;
  /** Re-attach a disconnected channel (or attach one) before hanging up. */
  reattach: boolean;
  /**
   * Wall-clock bound for the whole provider end (graceful shutdown). Each step gets
   * at most the time left; past it, the caller settles from the checkpoint.
   */
  deadlineAt?: number;
}): Promise<ProviderEndOutcome> {
  const outcome: ProviderEndOutcome = {
    finalUsageSeconds: null,
    closedReason: null,
    observed: false,
    hangup: "unsupported",
    sidebandClose: false,
    alreadyGone: false,
  };
  const deadlineAt = input.deadlineAt;
  const budget = (stepMs: number) =>
    deadlineAt === undefined ? stepMs : Math.min(stepMs, deadlineAt - Date.now());
  const bounded = <T>(work: Promise<T>, stepMs: number): Promise<T> =>
    deadlineAt === undefined && !Number.isFinite(stepMs) ? work : withTimeout(work, budget(stepMs));

  let channel = input.channel;
  if (input.reattach && budget(settings.attachTimeoutMs) > 0) {
    try {
      if (channel && !isConnected(channel) && channel.reattach) {
        await bounded(channel.reattach(), settings.attachTimeoutMs);
      } else if (!channel) {
        channel = await bounded(
          input.provider.attachControlChannel(input.providerSessionId),
          settings.attachTimeoutMs,
        );
      }
    } catch (error) {
      if (error instanceof ControlAttachError && error.sessionGone) outcome.alreadyGone = true;
    }
  }

  const observing = channel && isConnected(channel) ? channel : null;
  outcome.observed = Boolean(observing);
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const unsubscribe = observing?.subscribe((event) => {
    if (event.type !== "session.closed") return;
    outcome.finalUsageSeconds = event.usageSeconds;
    outcome.closedReason = event.reason;
    resolveClosed();
  });

  try {
    if (outcome.alreadyGone) return outcome;

    if (input.provider.hangupSession) {
      // The adapter bounds its own request; a shutdown deadline may cut it shorter.
      const hung = await bounded(input.provider.hangupSession(input.providerSessionId), Infinity).catch(
        () => ({ ok: false as const, reason: "timeout" as const }),
      );
      outcome.hangup = hung.ok ? "ok" : hung.reason === "not_found" ? "not_found" : "failed";
      if (outcome.hangup === "not_found") outcome.alreadyGone = true;
    }

    // Hard stop unavailable over HTTP: fall back to the sideband's own close.
    if ((outcome.hangup === "failed" || outcome.hangup === "unsupported") && observing) {
      if (budget(Infinity) <= 0) return outcome;
      outcome.sidebandClose = true;
      const result = await bounded(observing.close("close_requested"), Infinity).catch(() => null);
      if (result?.ok && outcome.finalUsageSeconds === null) {
        outcome.finalUsageSeconds = result.usageSeconds;
        outcome.closedReason = result.reason;
      } else if (result && !result.ok && result.usageFinalized && result.usageSeconds != null) {
        outcome.finalUsageSeconds ??= result.usageSeconds;
      }
      return outcome;
    }

    if (observing && outcome.finalUsageSeconds === null && outcome.hangup === "ok") {
      await bounded(closed, settings.closedWaitMs).catch(() => undefined);
    }
    return outcome;
  } finally {
    unsubscribe?.();
  }
}
