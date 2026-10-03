import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn(async () => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/db", () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
  }),
}));
vi.mock("@/lib/env", () => ({ env: { BETTER_AUTH_SECRET: "test-auth-secret-not-real-0123456789" } }));
vi.mock("@/lib/cors", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  jsonWithCors: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    Response.json(body, { status: init?.status ?? 200, headers: init?.headers }),
}));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/ai-config", () => ({ resolveAssistantModels: vi.fn() }));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));
vi.mock("@/lib/voice/metering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/metering")>()),
  settleVoiceUsage: vi.fn(async () => null),
}));
const recoverOrphanedVoiceSession = vi.fn(async () => ({ sessionId: "x", path: "checkpoint", settlement: null }));
vi.mock("@/lib/voice/recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/recovery")>()),
  recoverOrphanedVoiceSession: (...args: unknown[]) => recoverOrphanedVoiceSession(...(args as [])),
}));

import { fakeVoiceRuntime } from "@/lib/voice/__fixtures__/runtime";
import {
  clearEndedVoiceSessionsForTests,
  clearVoiceRuntimeForTests,
  createVoiceControlToken,
  registerVoiceRuntime,
  terminateVoiceSession,
  voiceRuntimeInstanceId,
} from "@/lib/voice";

import { POST } from "./route";

let seq = 0;
function freshId() {
  seq += 1;
  return `vs_hb_${seq}`;
}

async function beat(sessionId: string, token: string | null) {
  return POST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token === null ? {} : { token }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

function tokenFor(sessionId: string) {
  return createVoiceControlToken({ sessionId, visitorId: "visitor01" })!;
}

describe("POST /api/v1/voice/sessions/:sessionId/heartbeat", () => {
  beforeEach(() => {
    clearVoiceRuntimeForTests();
    clearEndedVoiceSessionsForTests();
    selectLimit.mockReset();
    selectLimit.mockResolvedValue([]);
    recoverOrphanedVoiceSession.mockClear();
  });

  it("rejects a missing, foreign or forged token without revealing the session", async () => {
    const id = freshId();
    registerVoiceRuntime(fakeVoiceRuntime({ sessionId: id }));
    expect((await beat(id, null)).status).toBe(404);
    expect((await beat(id, tokenFor("vs_other"))).status).toBe(404);
    expect((await beat(id, `${tokenFor(id)}x`)).status).toBe(404);
  });

  it("a live runtime answers healthy and records the heartbeat", async () => {
    const id = freshId();
    const runtime = fakeVoiceRuntime({ sessionId: id });
    runtime.supervision = {
      idleSince: 0,
      idleWarnedAt: null,
      maxDurationWarned: false,
      heartbeatCapable: true,
      lastHeartbeatAt: 0,
      timer: null,
    };
    registerVoiceRuntime(runtime);
    const response = await beat(id, tokenFor(id));
    expect(await response.json()).toEqual({ state: "healthy", nextHeartbeatMs: 5_000 });
    expect(runtime.supervision.lastHeartbeatAt).toBeGreaterThan(0);
  });

  it("answers degraded with a faster cadence while control re-attaches", async () => {
    const id = freshId();
    registerVoiceRuntime(
      fakeVoiceRuntime({
        sessionId: id,
        control: {
          state: "reattaching",
          lostAt: Date.now(),
          attempts: 1,
          lastGapMs: null,
          possibleLoss: false,
          interruptedDelegations: [],
        },
      }),
    );
    expect(await (await beat(id, tokenFor(id))).json()).toEqual({ state: "degraded", nextHeartbeatMs: 2_000 });
  });

  it("caps heartbeats at one per second per session", async () => {
    const id = freshId();
    registerVoiceRuntime(fakeVoiceRuntime({ sessionId: id }));
    expect((await beat(id, tokenFor(id))).status).toBe(200);
    const second = await beat(id, tokenFor(id));
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("1");
  });

  it("an ended widget session reports a neutral end reason", async () => {
    const id = freshId();
    const runtime = fakeVoiceRuntime({ sessionId: id, source: "widget", visitorId: "visitor01" });
    registerVoiceRuntime(runtime);
    runtime.endReason = "control_lost";
    await terminateVoiceSession(runtime, { reason: "connection_lost", requestProviderClose: false });
    const body = await (await beat(id, tokenFor(id))).json();
    expect(body).toMatchObject({ state: "ended", endReason: "disconnected" });
    expect(JSON.stringify(body)).not.toMatch(/control_lost|usage|quota|plan/i);
  });

  it("an unknown session is 404 and a settled row is ended", async () => {
    const missing = freshId();
    expect((await beat(missing, tokenFor(missing))).status).toBe(404);

    const settled = freshId();
    selectLimit.mockResolvedValueOnce([
      { id: settled, providerSessionId: "p", usageCheckpointAt: null, meteringStatus: "settled", runtimeInstanceId: null },
    ]);
    expect(await (await beat(settled, tokenFor(settled))).json()).toMatchObject({ state: "ended" });
    expect(recoverOrphanedVoiceSession).not.toHaveBeenCalled();
  });

  it("a session owned by another live instance answers 421 misrouted", async () => {
    const id = freshId();
    selectLimit.mockResolvedValueOnce([
      {
        id,
        providerSessionId: "p",
        usageCheckpointAt: new Date(),
        meteringStatus: "open",
        runtimeInstanceId: "rt_someone_else",
      },
    ]);
    const response = await beat(id, tokenFor(id));
    expect(response.status).toBe(421);
    expect(await response.json()).toMatchObject({ reason: "misrouted" });
    expect(recoverOrphanedVoiceSession).not.toHaveBeenCalled();
  });

  it("an open row with no live owner answers lost and starts recovery", async () => {
    const id = freshId();
    const row = {
      id,
      providerSessionId: "p",
      usageCheckpointAt: new Date(Date.now() - 60_000),
      meteringStatus: "open",
      runtimeInstanceId: "rt_dead",
    };
    selectLimit.mockResolvedValueOnce([row]);
    expect(await (await beat(id, tokenFor(id))).json()).toEqual({ state: "lost", nextHeartbeatMs: 5_000 });
    expect(recoverOrphanedVoiceSession).toHaveBeenCalledWith(
      { id, providerSessionId: "p", usageCheckpointAt: row.usageCheckpointAt },
      { trigger: "heartbeat" },
    );
  });

  it("a row this instance owns but no longer holds in memory is recovered too", async () => {
    const id = freshId();
    selectLimit.mockResolvedValueOnce([
      {
        id,
        providerSessionId: "p",
        usageCheckpointAt: new Date(),
        meteringStatus: "open",
        runtimeInstanceId: voiceRuntimeInstanceId(),
      },
    ]);
    expect(await (await beat(id, tokenFor(id))).json()).toMatchObject({ state: "lost" });
    expect(recoverOrphanedVoiceSession).toHaveBeenCalledTimes(1);
  });
});
