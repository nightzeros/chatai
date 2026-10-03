/**
 * Client supervision of the ChatAI Voice control plane.
 *
 * A live WebRTC connection is not proof that ChatAI still supervises the call: the
 * browser heartbeats ChatAI and, when control is lost, mutes the call and then ends
 * it within a bound.
 *
 * `healthy → suspect → reconnecting → healthy | terminated`, plus `closing` when the
 * server reports the session lost (muted while the provider close lands, then ended).
 *
 * Same state machine and thresholds as the widget's
 * `packages/widget-core/src/control-health.ts` (apps/web cannot import that package):
 * keep the two in sync.
 */

export const CONTROL_HEALTH_DEFAULTS = {
  intervalMs: 5_000,
  reconnectIntervalMs: 2_000,
  requestTimeoutMs: 4_000,
  failuresToReconnect: 2,
  silenceToReconnectMs: 12_000,
  reconnectGraceMs: 20_000,
  lostCloseWindowMs: 10_000,
  tickMs: 500,
};

export type ControlHealthSettings = typeof CONTROL_HEALTH_DEFAULTS;

export type ControlHealthStatus = "healthy" | "suspect" | "reconnecting" | "closing" | "terminated";

export type HeartbeatOutcome =
  | { kind: "healthy"; nextMs?: number }
  | { kind: "degraded"; nextMs?: number }
  | { kind: "ended"; endReason: string | null }
  | { kind: "lost" }
  /**
   * 421 misrouted or 429 rate limited: not a failure, but not proof of control either;
   * only `healthy` restores the call or resets the silence timer.
   */
  | { kind: "neutral"; nextMs?: number }
  | { kind: "failure" };

export type ControlHealthCause = "grace_expired" | "lost" | "ended";

export type ControlHealthState = {
  status: ControlHealthStatus;
  failures: number;
  lastSuccessAt: number;
  reconnectingSince: number | null;
  closingSince: number | null;
  /** Set when terminated: the server's public end reason, or `disconnected`. */
  endReason: string | null;
  cause: ControlHealthCause | null;
};

export function initialControlHealth(now: number): ControlHealthState {
  return {
    status: "healthy",
    failures: 0,
    lastSuccessAt: now,
    reconnectingSince: null,
    closingSince: null,
    endReason: null,
    cause: null,
  };
}

/** Mic and assistant audio must be silenced in these states. */
export function isControlMuted(status: ControlHealthStatus): boolean {
  return status === "reconnecting" || status === "closing";
}

function terminated(state: ControlHealthState, endReason: string, cause: ControlHealthCause): ControlHealthState {
  return { ...state, status: "terminated", endReason, cause };
}

function reconnecting(state: ControlHealthState, now: number): ControlHealthState {
  return { ...state, status: "reconnecting", reconnectingSince: state.reconnectingSince ?? now };
}

export function reduceControlHealth(
  state: ControlHealthState,
  input: HeartbeatOutcome | { kind: "tick" },
  now: number,
  settings: ControlHealthSettings = CONTROL_HEALTH_DEFAULTS,
): ControlHealthState {
  if (state.status === "terminated") return state;
  switch (input.kind) {
    case "tick":
      if (state.status === "closing" && now - (state.closingSince ?? now) >= settings.lostCloseWindowMs) {
        return terminated(state, "disconnected", "lost");
      }
      if (state.status === "reconnecting" && now - (state.reconnectingSince ?? now) >= settings.reconnectGraceMs) {
        return terminated(state, "disconnected", "grace_expired");
      }
      if (
        (state.status === "healthy" || state.status === "suspect") &&
        now - state.lastSuccessAt >= settings.silenceToReconnectMs
      ) {
        return reconnecting(state, now);
      }
      return state;
    case "healthy":
      if (state.status === "closing") return state;
      return { ...state, status: "healthy", failures: 0, lastSuccessAt: now, reconnectingSince: null };
    case "degraded":
      if (state.status === "closing") return state;
      return reconnecting({ ...state, failures: 0 }, now);
    case "neutral":
      // ChatAI answered without vouching for this call: neither control nor its loss.
      return state;
    case "failure": {
      const failures = state.failures + 1;
      if (state.status === "healthy" || state.status === "suspect") {
        return failures >= settings.failuresToReconnect
          ? reconnecting({ ...state, failures }, now)
          : { ...state, status: "suspect", failures };
      }
      return { ...state, failures };
    }
    case "ended":
      return terminated(state, input.endReason ?? "disconnected", "ended");
    case "lost":
      if (state.status === "closing") return state;
      return { ...state, status: "closing", closingSince: now, failures: 0 };
  }
}

/** Heartbeat HTTP answer → outcome. Anything unexpected counts as a failed attempt. */
export function classifyHeartbeatResponse(status: number, body: unknown): HeartbeatOutcome {
  const data = (body && typeof body === "object" ? body : {}) as {
    state?: unknown;
    nextHeartbeatMs?: unknown;
    endReason?: unknown;
  };
  const nextMs =
    typeof data.nextHeartbeatMs === "number" && data.nextHeartbeatMs > 0 ? data.nextHeartbeatMs : undefined;
  if (status === 421 || status === 429) return { kind: "neutral", ...(nextMs ? { nextMs } : {}) };
  if (status === 404) return { kind: "lost" };
  if (status !== 200) return { kind: "failure" };
  switch (data.state) {
    case "healthy":
      return { kind: "healthy", ...(nextMs ? { nextMs } : {}) };
    case "degraded":
      return { kind: "degraded", ...(nextMs ? { nextMs } : {}) };
    case "ended":
      return { kind: "ended", endReason: typeof data.endReason === "string" ? data.endReason : null };
    case "lost":
      return { kind: "lost" };
    default:
      return { kind: "failure" };
  }
}

export type ControlHealthMonitor = {
  start(): void;
  stop(): void;
  state(): ControlHealthState;
};

/**
 * Runs the heartbeat loop: one request in flight at a time, each bounded by
 * `requestTimeoutMs`. A response that arrives after its timeout, or after `stop()`,
 * is ignored, so a stale answer can never restore a newer failed state.
 */
export function createControlHealthMonitor(options: {
  send(signal: AbortSignal): Promise<HeartbeatOutcome>;
  onChange(next: ControlHealthState, previous: ControlHealthState): void;
  intervalMs?: number;
  settings?: Partial<ControlHealthSettings>;
  now?: () => number;
}): ControlHealthMonitor {
  const now = options.now ?? (() => Date.now());
  const settings: ControlHealthSettings = {
    ...CONTROL_HEALTH_DEFAULTS,
    ...options.settings,
    ...(options.intervalMs && options.intervalMs > 0 ? { intervalMs: options.intervalMs } : {}),
  };
  let state = initialControlHealth(now());
  let running = false;
  let beatTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight: AbortController | null = null;
  let requestTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    running = false;
    if (beatTimer) clearTimeout(beatTimer);
    beatTimer = null;
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = null;
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    const request = inFlight;
    inFlight = null;
    request?.abort();
  };

  /** `onChange` fires on status transitions only. */
  const apply = (input: HeartbeatOutcome | { kind: "tick" }) => {
    if (!running) return;
    const previous = state;
    const next = reduceControlHealth(previous, input, now(), settings);
    state = next;
    if (next.status === previous.status) return;
    if (next.status === "terminated") stop();
    options.onChange(next, previous);
  };

  const schedule = (delayMs: number) => {
    if (!running) return;
    if (beatTimer) clearTimeout(beatTimer);
    beatTimer = setTimeout(() => void beat(), Math.max(0, delayMs));
  };

  const beat = async () => {
    beatTimer = null;
    if (!running || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    const abortedOrTimedOut = new Promise<HeartbeatOutcome>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve({ kind: "failure" }), { once: true });
      requestTimer = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
    });
    const outcome = await Promise.race([
      options.send(controller.signal).catch((): HeartbeatOutcome => ({ kind: "failure" })),
      abortedOrTimedOut,
    ]);
    if (inFlight !== controller) return;
    if (requestTimer) clearTimeout(requestTimer);
    requestTimer = null;
    inFlight = null;
    apply(outcome);
    if (!running) return;
    const hinted = "nextMs" in outcome ? outcome.nextMs : undefined;
    const fast = isControlMuted(state.status);
    schedule(fast ? Math.min(hinted ?? settings.reconnectIntervalMs, settings.reconnectIntervalMs) : (hinted ?? settings.intervalMs));
  };

  return {
    start() {
      if (running || state.status === "terminated") return;
      running = true;
      state = initialControlHealth(now());
      schedule(settings.intervalMs);
      tickTimer = setInterval(() => apply({ kind: "tick" }), settings.tickMs);
    },
    stop,
    state: () => state,
  };
}
