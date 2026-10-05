import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyHeartbeatResponse,
  CONTROL_HEALTH_DEFAULTS,
  createControlHealthMonitor,
  initialControlHealth,
  isControlMuted,
  reduceControlHealth,
  type ControlHealthState,
  type HeartbeatOutcome,
} from "./control-health";

const healthy: HeartbeatOutcome = { kind: "healthy" };
const failure: HeartbeatOutcome = { kind: "failure" };

function run(inputs: Array<[number, HeartbeatOutcome | { kind: "tick" }]>, start = initialControlHealth(0)) {
  return inputs.reduce((state, [at, input]) => reduceControlHealth(state, input, at), start);
}

describe("reduceControlHealth", () => {
  it("stays healthy through a healthy heartbeat loop", () => {
    const state = run([
      [5_000, healthy],
      [10_000, healthy],
      [11_000, { kind: "tick" }],
      [15_000, healthy],
    ]);
    expect(state).toMatchObject({ status: "healthy", failures: 0, lastSuccessAt: 15_000 });
  });

  it("treats a single failure as internal suspicion only", () => {
    const state = run([[5_000, failure]]);
    expect(state.status).toBe("suspect");
    expect(isControlMuted(state.status)).toBe(false);
    expect(run([[10_000, healthy]], state)).toMatchObject({ status: "healthy", failures: 0 });
  });

  it("reconnects after two consecutive failures", () => {
    const state = run([
      [5_000, failure],
      [7_000, failure],
    ]);
    expect(state).toMatchObject({ status: "reconnecting", reconnectingSince: 7_000 });
    expect(isControlMuted(state.status)).toBe(true);
  });

  it("reconnects after ~12 s without a successful heartbeat", () => {
    expect(run([[11_999, { kind: "tick" }]]).status).toBe("healthy");
    expect(run([[12_000, { kind: "tick" }]])).toMatchObject({ status: "reconnecting", reconnectingSince: 12_000 });
  });

  it("reconnects when the server reports degraded, and recovers on healthy", () => {
    const degraded = run([[5_000, { kind: "degraded" }]]);
    expect(degraded.status).toBe("reconnecting");
    const recovered = run([[9_000, healthy]], degraded);
    expect(recovered).toMatchObject({ status: "healthy", reconnectingSince: null, lastSuccessAt: 9_000 });
  });

  it("terminates as disconnected once the 20 s grace expires", () => {
    const reconnecting = run([[5_000, { kind: "degraded" }]]);
    expect(run([[24_999, { kind: "tick" }]], reconnecting).status).toBe("reconnecting");
    // Further failures do not restart the grace window.
    const stillFailing = run([[20_000, failure]], reconnecting);
    expect(run([[25_000, { kind: "tick" }]], stillFailing)).toMatchObject({
      status: "terminated",
      endReason: "disconnected",
      cause: "grace_expired",
    });
  });

  it("terminates with the server's public end reason", () => {
    for (const endReason of ["idle", "disconnected", "max_duration"]) {
      expect(run([[5_000, { kind: "ended", endReason }]])).toMatchObject({ status: "terminated", endReason, cause: "ended" });
    }
    expect(run([[5_000, { kind: "ended", endReason: null }]]).endReason).toBe("disconnected");
  });

  it("stays muted while a lost session closes, then terminates regardless", () => {
    const closing = run([[5_000, { kind: "lost" }]]);
    expect(closing).toMatchObject({ status: "closing", closingSince: 5_000 });
    expect(isControlMuted(closing.status)).toBe(true);
    // Nothing brings a lost session back.
    expect(run([[6_000, healthy], [7_000, { kind: "degraded" }], [8_000, { kind: "lost" }]], closing).status).toBe("closing");
    expect(run([[14_999, { kind: "tick" }]], closing).status).toBe("closing");
    expect(run([[15_000, { kind: "tick" }]], closing)).toMatchObject({
      status: "terminated",
      endReason: "disconnected",
      cause: "lost",
    });
  });

  it("an explicit end still wins while closing", () => {
    const closing = run([[5_000, { kind: "lost" }]]);
    expect(run([[6_000, { kind: "ended", endReason: "idle" }]], closing)).toMatchObject({ status: "terminated", endReason: "idle" });
  });

  it("treats misroute/rate-limit answers as neither a failure nor proof of control", () => {
    const state = run([
      [5_000, { kind: "neutral" }],
      [7_000, { kind: "neutral" }],
      [9_000, { kind: "neutral" }],
    ]);
    expect(state).toMatchObject({ status: "healthy", failures: 0, lastSuccessAt: 0 });
    // Never counted as a failure…
    expect(run([[6_000, { kind: "neutral" }]], run([[5_000, failure]]))).toMatchObject({ status: "suspect", failures: 1 });
    // …never restores a muted call…
    expect(run([[6_000, { kind: "neutral" }]], run([[5_000, { kind: "degraded" }]])).status).toBe("reconnecting");
    // …and never resets the silence timer: only `healthy` proves ChatAI controls this call.
    expect(run([[11_000, { kind: "neutral" }], [12_000, { kind: "tick" }]]).status).toBe("reconnecting");
  });

  it("a restarted server answering 421 before the second miss cannot restore Connected", () => {
    // Old owner killed: one miss (suspect), then the new process answers misrouted.
    const state = run([
      [5_000, failure],
      [7_000, { kind: "neutral" }],
      [9_000, { kind: "neutral" }],
    ]);
    expect(state.status).toBe("suspect");
    expect(run([[12_000, { kind: "tick" }]], state).status).toBe("reconnecting");
  });

  it("is final once terminated", () => {
    const done: ControlHealthState = run([[5_000, { kind: "ended", endReason: "idle" }]]);
    expect(run([[6_000, healthy], [7_000, { kind: "tick" }]], done)).toBe(done);
  });
});

describe("classifyHeartbeatResponse", () => {
  it("maps HTTP answers to outcomes", () => {
    expect(classifyHeartbeatResponse(200, { state: "healthy", nextHeartbeatMs: 5000 })).toEqual({ kind: "healthy", nextMs: 5000 });
    expect(classifyHeartbeatResponse(200, { state: "degraded", nextHeartbeatMs: 2000 })).toEqual({ kind: "degraded", nextMs: 2000 });
    expect(classifyHeartbeatResponse(200, { state: "ended", endReason: "idle" })).toEqual({ kind: "ended", endReason: "idle" });
    expect(classifyHeartbeatResponse(200, { state: "lost" })).toEqual({ kind: "lost" });
    expect(classifyHeartbeatResponse(404, { error: "not_found" })).toEqual({ kind: "lost" });
    expect(classifyHeartbeatResponse(421, { error: "misrouted" })).toEqual({ kind: "neutral" });
    expect(classifyHeartbeatResponse(429, { error: "rate_limited" })).toEqual({ kind: "neutral" });
    expect(classifyHeartbeatResponse(500, null)).toEqual({ kind: "failure" });
    expect(classifyHeartbeatResponse(503, { state: "healthy" })).toEqual({ kind: "failure" });
    expect(classifyHeartbeatResponse(200, { state: "surprise" })).toEqual({ kind: "failure" });
    expect(classifyHeartbeatResponse(200, "garbage")).toEqual({ kind: "failure" });
  });
});

describe("createControlHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  type Pending = { resolve(outcome: HeartbeatOutcome): void; reject(error: unknown): void; signal: AbortSignal };

  function monitor(respond?: (signal: AbortSignal) => Promise<HeartbeatOutcome>) {
    const pending: Pending[] = [];
    const changes: Array<[ControlHealthState, ControlHealthState]> = [];
    const send = vi.fn(
      respond ??
        ((signal: AbortSignal) =>
          new Promise<HeartbeatOutcome>((resolve, reject) => {
            pending.push({ resolve, reject, signal });
          })),
    );
    const instance = createControlHealthMonitor({
      send,
      onChange: (next, previous) => changes.push([next, previous]),
    });
    return { instance, send, pending, changes, statuses: () => changes.map(([next]) => next.status) };
  }

  it("heartbeats on the interval and stays silent while healthy", async () => {
    const m = monitor(async () => healthy);
    m.instance.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(m.send).toHaveBeenCalledTimes(6);
    expect(m.changes).toEqual([]);
    expect(m.instance.state().status).toBe("healthy");
    m.instance.stop();
  });

  it("follows the server's nextHeartbeatMs hint", async () => {
    const m = monitor(async () => ({ kind: "healthy", nextMs: 10_000 }));
    m.instance.start();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(m.send).toHaveBeenCalledTimes(3);
    m.instance.stop();
  });

  it("counts a timed-out request as one failure: suspect, not reconnecting", async () => {
    const m = monitor();
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CONTROL_HEALTH_DEFAULTS.requestTimeoutMs);
    expect(m.pending[0]!.signal.aborted).toBe(true);
    expect(m.statuses()).toEqual(["suspect"]);
    m.instance.stop();
  });

  it("reconnects on two consecutive failures and heartbeats faster while reconnecting", async () => {
    const m = monitor(async () => failure);
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.statuses()).toEqual(["suspect"]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.statuses()).toEqual(["suspect", "reconnecting"]);
    const before = m.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(m.send.mock.calls.length - before).toBe(3);
    m.instance.stop();
  });

  it("recovers when heartbeats succeed again within the grace", async () => {
    let answer: HeartbeatOutcome = { kind: "degraded" };
    const m = monitor(async () => answer);
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.instance.state().status).toBe("reconnecting");
    answer = healthy;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(m.statuses()).toEqual(["reconnecting", "healthy"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.instance.state().status).toBe("healthy");
    m.instance.stop();
  });

  it("terminates once after the grace and cleans up every timer and request", async () => {
    const m = monitor(async () => failure);
    m.instance.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.instance.state().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(CONTROL_HEALTH_DEFAULTS.reconnectGraceMs);
    expect(m.statuses()).toEqual(["suspect", "reconnecting", "terminated"]);
    expect(m.instance.state()).toMatchObject({ endReason: "disconnected", cause: "grace_expired" });
    expect(vi.getTimerCount()).toBe(0);
    const sent = m.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(m.send.mock.calls.length).toBe(sent);
    // Restarting a terminated monitor is a no-op: Voice is never revived automatically.
    m.instance.start();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a stale response cannot restore a newer failed state", async () => {
    const m = monitor();
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    const stale = m.pending[0]!;
    await vi.advanceTimersByTimeAsync(4_000); // times out → suspect
    await vi.advanceTimersByTimeAsync(5_000);
    const next = m.pending[1]!;
    await vi.advanceTimersByTimeAsync(4_000); // times out → reconnecting
    expect(m.instance.state().status).toBe("reconnecting");
    stale.resolve(healthy);
    next.resolve(healthy);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.instance.state().status).toBe("reconnecting");
    m.instance.stop();
  });

  it("a recovery that lands after the grace expired is ignored", async () => {
    const m = monitor();
    m.instance.start();
    // Two timeouts → reconnecting at t=18s (5+4, then 9+5+4).
    await vi.advanceTimersByTimeAsync(18_000);
    expect(m.instance.state().status).toBe("reconnecting");
    // Heartbeats keep hanging until the grace expires at t=38s.
    await vi.advanceTimersByTimeAsync(19_000);
    const inFlight = m.pending.at(-1)!;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(m.instance.state().status).toBe("terminated");
    expect(inFlight.signal.aborted).toBe(true);
    inFlight.resolve(healthy);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.statuses().filter((status) => status === "terminated")).toHaveLength(1);
    expect(m.instance.state().status).toBe("terminated");
  });

  it("a recovery just before the grace expires wins", async () => {
    let answer: HeartbeatOutcome = { kind: "degraded" };
    const m = monitor(async () => answer);
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    answer = failure;
    // Reconnecting since t=5s, so the grace would expire at t=25s; recover at t=23s.
    await vi.advanceTimersByTimeAsync(17_000);
    answer = healthy;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(m.instance.state().status).toBe("healthy");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(m.statuses()).not.toContain("terminated");
    m.instance.stop();
  });

  it("treats a thrown fetch as a failure", async () => {
    const m = monitor(async () => {
      throw new TypeError("Failed to fetch");
    });
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.statuses()).toEqual(["suspect"]);
    m.instance.stop();
  });

  it("stop() aborts the in-flight request and clears all timers", async () => {
    const m = monitor();
    m.instance.start();
    await vi.advanceTimersByTimeAsync(5_000);
    m.instance.stop();
    expect(m.pending[0]!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    m.pending[0]!.resolve({ kind: "ended", endReason: "idle" });
    await vi.advanceTimersByTimeAsync(0);
    expect(m.changes).toEqual([]);
  });
});
