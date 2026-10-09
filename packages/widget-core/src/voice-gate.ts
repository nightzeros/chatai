/**
 * Browser half of ChatAI's server-authoritative Voice playback gate.
 *
 * The realtime model speaks straight to the browser and ChatAI cannot stop it, so
 * assistant audio and captions stay muted unless ChatAI's latest decision for the
 * call is `open`. Decisions arrive as NDJSON on POST /api/v1/voice/sessions/:id/gate;
 * while that stream is down the gate is closed.
 */

export const PLAYBACK_GATE_DEFAULTS = {
  reconnectMinMs: 250,
  reconnectMaxMs: 4_000,
  /** The server sends a keepalive every 10 s; a stream silent this long is dead. */
  staleAfterMs: 25_000,
};

export type PlaybackGateSettings = typeof PLAYBACK_GATE_DEFAULTS;

type GateDecision = { seq: number; state: "open" | "closed"; inputEndMs: number | null };

export type PlaybackGate = {
  start(): void;
  stop(): void;
  isOpen(): boolean;
  /**
   * Visitor speech on the provider timeline. Speech starting at or after the end of
   * the input the open decision covered is a new turn: close without waiting.
   */
  noteInput(startMs: number | undefined): void;
};

type GateLine = { type: "gate"; decision: GateDecision } | { type: "keepalive" } | { type: "end" } | null;

export function parseGateLine(line: string): GateLine {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const event = data as { type?: unknown; seq?: unknown; state?: unknown; inputEndMs?: unknown };
  if (event.type === "keepalive" || event.type === "end") return { type: event.type };
  if (
    event.type !== "gate" ||
    typeof event.seq !== "number" ||
    (event.state !== "open" && event.state !== "closed")
  ) {
    return null;
  }
  return {
    type: "gate",
    decision: {
      seq: event.seq,
      state: event.state,
      inputEndMs: typeof event.inputEndMs === "number" ? event.inputEndMs : null,
    },
  };
}

export function createPlaybackGate(options: {
  /** Opens the decision stream (POST with the control token). */
  connect(signal: AbortSignal): Promise<Response>;
  /** Fires when audibility changes. */
  onChange(open: boolean): void;
  settings?: Partial<PlaybackGateSettings>;
}): PlaybackGate {
  const settings: PlaybackGateSettings = { ...PLAYBACK_GATE_DEFAULTS, ...options.settings };
  let running = false;
  let streamUp = false;
  let decision: GateDecision | null = null;
  let locallyClosed = false;
  let lastInputStartMs: number | null = null;
  let attempt = 0;
  let inFlight: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let open = false;

  const isOpen = () => running && streamUp && decision?.state === "open" && !locallyClosed;

  const update = () => {
    const next = isOpen();
    if (next === open) return;
    open = next;
    options.onChange(open);
  };

  const spokeSince = (inputEndMs: number | null) =>
    lastInputStartMs !== null && (inputEndMs === null || lastInputStartMs >= inputEndMs);

  const apply = (next: GateDecision) => {
    if (decision && next.seq <= decision.seq) return;
    decision = next;
    // An approval the visitor has already spoken past is stale.
    locallyClosed = next.state === "open" && spokeSince(next.inputEndMs);
  };

  const clearStale = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
  };

  const armStale = (controller: AbortController) => {
    clearStale();
    staleTimer = setTimeout(() => controller.abort(), settings.staleAfterMs);
  };

  /** Reads until the stream closes; true when the server ended it for good. */
  const read = async (body: ReadableStream<Uint8Array>, controller: AbortController): Promise<boolean> => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    armStale(controller);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || inFlight !== controller) return false;
        armStale(controller);
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const event = parseGateLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (event?.type === "end") return true;
          if (event?.type === "gate") {
            attempt = 0;
            streamUp = true;
            apply(event.decision);
            update();
          }
        }
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
  };

  const connect = async () => {
    retryTimer = null;
    if (!running) return;
    const controller = new AbortController();
    inFlight = controller;
    let finished = false;
    try {
      const response = await options.connect(controller.signal);
      // Unknown session: it is over; the control heartbeat reports how it ended.
      if (response.status === 404) finished = true;
      else if (response.ok && response.body) finished = await read(response.body, controller);
    } catch {
      // Network error or stale stream: reconnect below.
    }
    if (inFlight !== controller) return;
    inFlight = null;
    clearStale();
    streamUp = false;
    update();
    if (finished || !running) return;
    const delay = Math.min(settings.reconnectMaxMs, settings.reconnectMinMs * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(() => void connect(), delay);
  };

  return {
    start() {
      if (running) return;
      running = true;
      void connect();
    },
    stop() {
      running = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      clearStale();
      const request = inFlight;
      inFlight = null;
      request?.abort();
      streamUp = false;
      open = false;
    },
    isOpen,
    noteInput(startMs) {
      if (typeof startMs !== "number") return;
      lastInputStartMs = Math.max(lastInputStartMs ?? startMs, startMs);
      if (decision?.state === "open" && !locallyClosed && spokeSince(decision.inputEndMs)) {
        locallyClosed = true;
        update();
      }
    },
  };
}
