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

import { fakeVoiceRuntime } from "@/lib/voice/__fixtures__/runtime";
import {
  clearEndedVoiceSessionsForTests,
  clearVoiceRuntimeForTests,
  createVoiceControlToken,
  registerVoiceRuntime,
  terminateVoiceSession,
} from "@/lib/voice";
import { setVoiceGate, voiceGateOf } from "@/lib/voice/turn-gate";

import { POST } from "./route";

let seq = 0;
function freshId() {
  seq += 1;
  return `vs_gate_${seq}`;
}

function openGate(sessionId: string, token: string | null, signal?: AbortSignal) {
  return POST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${sessionId}/gate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token === null ? {} : { token }),
      ...(signal ? { signal } : {}),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

function tokenFor(sessionId: string) {
  return createVoiceControlToken({ sessionId, visitorId: "visitor01" })!;
}

/** Reads NDJSON lines from a streaming response, one at a time. */
function lineReader(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<Record<string, unknown> | null> {
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          return JSON.parse(line) as Record<string, unknown>;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

describe("POST /api/v1/voice/sessions/:sessionId/gate", () => {
  beforeEach(() => {
    clearVoiceRuntimeForTests();
    clearEndedVoiceSessionsForTests();
    selectLimit.mockReset();
    selectLimit.mockResolvedValue([]);
  });

  it("rejects a missing, foreign or forged token without revealing the session", async () => {
    const id = freshId();
    registerVoiceRuntime(fakeVoiceRuntime({ sessionId: id }));
    expect((await openGate(id, null)).status).toBe(404);
    expect((await openGate(id, tokenFor("vs_other"))).status).toBe(404);
    expect((await openGate(id, `${tokenFor(id)}x`)).status).toBe(404);
  });

  it("an unknown session is 404; one owned by another live instance is 421", async () => {
    const missing = freshId();
    expect((await openGate(missing, tokenFor(missing))).status).toBe(404);

    const foreign = freshId();
    selectLimit.mockResolvedValueOnce([
      { meteringStatus: "open", runtimeInstanceId: "rt_someone_else", usageCheckpointAt: new Date() },
    ]);
    const response = await openGate(foreign, tokenFor(foreign));
    expect(response.status).toBe(421);
    expect(await response.json()).toMatchObject({ reason: "misrouted" });
  });

  it("streams the current decision first, then every open and the first close after it", async () => {
    const id = freshId();
    const runtime = fakeVoiceRuntime({ sessionId: id });
    registerVoiceRuntime(runtime);
    const response = await openGate(id, tokenFor(id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const lines = lineReader(response);
    expect(await lines.next()).toEqual({ type: "gate", seq: 0, state: "closed", reason: "start", inputEndMs: null });

    runtime.inputFragments.push({ text: "Hi", startMs: 1_000, endMs: 1_400 });
    setVoiceGate(runtime, "open", "social");
    expect(await lines.next()).toEqual({ type: "gate", seq: 1, state: "open", reason: "social", inputEndMs: 1_400 });

    setVoiceGate(runtime, "closed", "user_speaking");
    // Staying closed is not re-sent; the next open is.
    setVoiceGate(runtime, "closed", "pending_backend");
    setVoiceGate(runtime, "open", "backend_answer");
    expect(await lines.next()).toMatchObject({ seq: 2, state: "closed", reason: "user_speaking" });
    expect(await lines.next()).toMatchObject({ seq: 3, state: "open", reason: "backend_answer" });
    await lines.cancel();
    expect(voiceGateOf(runtime).listeners.size).toBe(0);
  });

  it("ends the stream when the call ends; later requests are 404", async () => {
    const id = freshId();
    const runtime = fakeVoiceRuntime({ sessionId: id });
    registerVoiceRuntime(runtime);
    const lines = lineReader(await openGate(id, tokenFor(id)));
    expect(await lines.next()).toMatchObject({ type: "gate", state: "closed" });

    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: false });
    expect(await lines.next()).toEqual({ type: "end" });
    expect(await lines.next()).toBeNull();
    expect((await openGate(id, tokenFor(id))).status).toBe(404);
  });

  it("a client disconnect unsubscribes the stream", async () => {
    const id = freshId();
    const runtime = fakeVoiceRuntime({ sessionId: id });
    registerVoiceRuntime(runtime);
    const controller = new AbortController();
    const lines = lineReader(await openGate(id, tokenFor(id), controller.signal));
    await lines.next();
    expect(voiceGateOf(runtime).listeners.size).toBe(1);
    controller.abort();
    await vi.waitFor(() => expect(voiceGateOf(runtime).listeners.size).toBe(0));
  });

  it("caps concurrent streams per session", async () => {
    const id = freshId();
    registerVoiceRuntime(fakeVoiceRuntime({ sessionId: id }));
    const open = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await openGate(id, tokenFor(id));
      expect(response.status).toBe(200);
      open.push(lineReader(response));
    }
    const refused = await openGate(id, tokenFor(id));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("1");
    await Promise.all(open.map((lines) => lines.cancel()));
  });
});
