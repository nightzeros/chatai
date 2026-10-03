import {
  classifyHeartbeatResponse,
  createControlHealthMonitor,
  isControlMuted,
  type ControlHealthSettings,
  type ControlHealthState,
  type HeartbeatOutcome,
} from "./control-health";
import {
  CONTROL_GRACE_EXPIRED_NOTICE,
  CONTROL_SESSION_LOST_NOTICE,
  voiceEndNotice,
  type OwnerControlView,
} from "./voice-state";

export type PlaygroundControlView = Pick<OwnerControlView, "health" | "heartbeatFailures" | "misrouted">;

export type PlaygroundControl = {
  start(): void;
  stop(): void;
  state(): ControlHealthState;
};

/** Owner copy for a control-driven end; the specific internal reason is fine for owners. */
export function controlEndNotice(state: ControlHealthState): string {
  if (state.cause === "grace_expired") return CONTROL_GRACE_EXPIRED_NOTICE;
  if (state.cause === "lost") return CONTROL_SESSION_LOST_NOTICE;
  return voiceEndNotice(state.endReason) ?? "The call was ended by ChatAI.";
}

/**
 * The Playground's control-health supervision: heartbeats the owner's live session
 * with its control token, mutes while control is unavailable and ends the call
 * after the bounded grace. It never restarts Voice itself.
 */
export function createPlaygroundControl(options: {
  sessionId: string;
  token: string;
  intervalMs?: number;
  fetch?: typeof fetch;
  /** Silence (true) or restore (false) the mic track and assistant audio. */
  setMuted(muted: boolean): void;
  onView(view: PlaygroundControlView): void;
  onTerminated(notice: string, state: ControlHealthState): void;
  settings?: Partial<ControlHealthSettings>;
  now?: () => number;
}): PlaygroundControl {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let misrouted = false;

  const view = (state: ControlHealthState): PlaygroundControlView => ({
    health: state.status,
    heartbeatFailures: state.failures,
    misrouted,
  });

  const send = async (signal: AbortSignal): Promise<HeartbeatOutcome> => {
    const response = await fetcher(`/api/v1/voice/sessions/${encodeURIComponent(options.sessionId)}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: options.token }),
      cache: "no-store",
      signal,
    });
    const nextMisrouted = response.status === 421;
    if (nextMisrouted !== misrouted) {
      misrouted = nextMisrouted;
      options.onView(view(monitor.state()));
    }
    return classifyHeartbeatResponse(response.status, await response.json().catch(() => null));
  };

  const monitor = createControlHealthMonitor({
    send,
    intervalMs: options.intervalMs,
    settings: options.settings,
    ...(options.now ? { now: options.now } : {}),
    onChange(next, previous) {
      if (next.status === "terminated") {
        options.onTerminated(controlEndNotice(next), next);
        return;
      }
      const muted = isControlMuted(next.status);
      if (muted !== isControlMuted(previous.status)) options.setMuted(muted);
      options.onView(view(next));
    },
  });

  return monitor;
}
