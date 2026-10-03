import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTROL_HEALTH_DEFAULTS } from "./control-health";
import { controlEndNotice, createPlaygroundControl, type PlaygroundControlView } from "./playground-control";
import {
  CONTROL_GRACE_EXPIRED_NOTICE,
  CONTROL_SESSION_LOST_NOTICE,
  deriveVoicePhase,
  isPlaygroundVoiceActive,
  ownerControlDetail,
  voiceEndNotice,
} from "./voice-state";

type Reply = () => Response | Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

const json = (state: string, extra: Record<string, unknown> = {}) => Response.json({ state, ...extra });
const failing: Reply = () => {
  throw new TypeError("Failed to fetch");
};

function setup(reply: Reply) {
  const muted: boolean[] = [];
  const views: PlaygroundControlView[] = [];
  const terminated: string[] = [];
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return reply();
  }) as unknown as typeof fetch;
  const control = createPlaygroundControl({
    sessionId: "vs_1",
    token: "ct_secret",
    intervalMs: 5_000,
    fetch: fetcher,
    setMuted: (value) => muted.push(value),
    onView: (view) => views.push(view),
    onTerminated: (notice) => terminated.push(notice),
  });
  control.start();
  return { control, muted, views, terminated, requests };
}

describe("Playground control health", () => {
  it("heartbeats the owner session with its control token and stays quiet while healthy", async () => {
    const t = setup(() => json("healthy"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.requests).toHaveLength(6);
    expect(t.requests[0]).toEqual({ url: "/api/v1/voice/sessions/vs_1/heartbeat", body: { token: "ct_secret" } });
    expect(t.muted).toEqual([]);
    expect(t.terminated).toEqual([]);
    t.control.stop();
  });

  it("one miss is only suspicion; two misses mute mic and assistant", async () => {
    const t = setup(failing);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.muted).toEqual([]);
    expect(t.views.at(-1)).toMatchObject({ health: "suspect", heartbeatFailures: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.muted).toEqual([true]);
    expect(t.views.at(-1)).toMatchObject({ health: "reconnecting", heartbeatFailures: 2 });
    t.control.stop();
  });

  it("degraded mutes; recovery restores audio without starting a new session", async () => {
    let state = "degraded";
    const t = setup(() => json(state));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.muted).toEqual([true]);
    state = "healthy";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.muted).toEqual([true, false]);
    expect(t.terminated).toEqual([]);
    expect(t.requests.every((request) => request.url.endsWith("/heartbeat"))).toBe(true);
    t.control.stop();
  });

  it("ends the call after the 20 s grace, once, and stops heartbeating", async () => {
    const t = setup(failing);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.terminated).toEqual([CONTROL_GRACE_EXPIRED_NOTICE]);
    const sent = t.requests.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.requests).toHaveLength(sent);
    expect(t.terminated).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a lost session stays muted through the close window, then ends", async () => {
    const t = setup(() => Response.json({ error: "Voice session not found." }, { status: 404 }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.muted).toEqual([true]);
    await vi.advanceTimersByTimeAsync(CONTROL_HEALTH_DEFAULTS.lostCloseWindowMs);
    expect(t.terminated).toEqual([CONTROL_SESSION_LOST_NOTICE]);
  });

  it("shows the owner the specific internal end reason", async () => {
    const t = setup(() => json("ended", { endReason: "control_lost" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.terminated).toEqual([voiceEndNotice("control_lost")]);
    expect(t.terminated[0]).toMatch(/sideband/);
  });

  it("421 is surfaced to the owner as misrouting and is not counted as a failure", async () => {
    let n = 0;
    const t = setup(() =>
      n++ % 2 === 0
        ? Response.json({ error: "handled elsewhere", reason: "misrouted" }, { status: 421 })
        : json("healthy"),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.muted).toEqual([]);
    expect(t.terminated).toEqual([]);
    expect(t.views.some((view) => view.misrouted)).toBe(true);
    t.control.stop();
  });

  it("421/429 alone never prove control: the call mutes after ~12 s without a healthy answer", async () => {
    const t = setup(() => Response.json({ error: "Too many heartbeats." }, { status: 429 }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.muted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(t.muted).toEqual([true]);
    t.control.stop();
  });

  it("stop() (manual end while muted) clears every timer and ignores later answers", async () => {
    let release!: (response: Response) => void;
    let hang = false;
    const t = setup(() => (hang ? new Promise<Response>((resolve) => (release = resolve)) : failing()));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.muted).toEqual([true]);
    hang = true;
    await vi.advanceTimersByTimeAsync(2_000);
    t.control.stop();
    expect(vi.getTimerCount()).toBe(0);
    release(json("healthy"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.muted).toEqual([true]);
    expect(t.terminated).toEqual([]);
  });
});

describe("Playground owner copy", () => {
  it("names every administrative end reason for the owner", () => {
    for (const reason of ["idle", "max_duration", "heartbeat_lost", "control_lost", "disconnected", "usage_limit", "superseded"]) {
      expect(voiceEndNotice(reason)).toBeTruthy();
    }
    expect(voiceEndNotice("close_requested")).toBeNull();
  });

  it("maps control-driven ends to owner copy", () => {
    const base = { status: "terminated" as const, failures: 0, lastSuccessAt: 0, reconnectingSince: null, closingSince: null };
    expect(controlEndNotice({ ...base, endReason: "disconnected", cause: "grace_expired" })).toBe(CONTROL_GRACE_EXPIRED_NOTICE);
    expect(controlEndNotice({ ...base, endReason: "disconnected", cause: "lost" })).toBe(CONTROL_SESSION_LOST_NOTICE);
    expect(controlEndNotice({ ...base, endReason: "idle", cause: "ended" })).toBe(voiceEndNotice("idle"));
  });

  it("shows sideband and heartbeat detail with ids and numbers only", () => {
    expect(ownerControlDetail({ health: "healthy", heartbeatFailures: 0, misrouted: false, sideband: null })).toBeNull();
    expect(
      ownerControlDetail({
        health: "reconnecting",
        heartbeatFailures: 2,
        misrouted: false,
        sideband: { state: "reattaching", attempts: 3, lastGapMs: null, possibleLoss: false },
      }),
    ).toBe("ChatAI control unavailable: mic and assistant muted (2 failed heartbeats) · Sideband re-attaching (attempt 3)");
    expect(
      ownerControlDetail({
        health: "healthy",
        heartbeatFailures: 0,
        misrouted: false,
        sideband: { state: "attached", attempts: 1, lastGapMs: 2_400, possibleLoss: true },
      }),
    ).toBe("Sideband re-attached after 1 attempt · 2400 ms gap · events may have been missed");
  });

  it("control loss is its own muted phase, distinct from the manual re-mint", () => {
    const signals = { now: 0, userVoiceAt: 0, assistantVoiceAt: 0, delegationActive: true, interruptedAt: null };
    expect(deriveVoicePhase({ ...signals, connection: "degraded" })).toBe("control_lost");
    expect(deriveVoicePhase({ ...signals, connection: "reconnecting" })).toBe("reconnecting");
    expect(isPlaygroundVoiceActive("degraded")).toBe(true);
    expect(isPlaygroundVoiceActive("ended")).toBe(false);
  });
});

describe("control-health copies", () => {
  it("the Playground and widget state machines stay identical", () => {
    const body = (path: string) => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      return source.slice(source.indexOf("*/") + 2);
    };
    expect(body("./control-health.ts")).toBe(body("../../../../../packages/widget-core/src/control-health.ts"));
  });
});
