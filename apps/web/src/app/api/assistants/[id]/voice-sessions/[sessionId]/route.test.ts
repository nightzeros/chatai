import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn(async () => undefined);
vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({ values: insertValues }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));
vi.mock("@/lib/env", () => ({ env: {} }));

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: () => getSession() }));

const getOwnedAssistant = vi.fn();
vi.mock("@/lib/assistants", () => ({
  getOwnedAssistant: (...args: unknown[]) => getOwnedAssistant(...args),
}));

import { fakeVoiceRuntime } from "@/lib/voice/__fixtures__/runtime";
import { terminateVoiceSession } from "@/lib/voice/lifecycle";
import { clearVoiceRuntimeForTests, registerVoiceRuntime } from "@/lib/voice/session-runtime";

import { GET } from "./route";

function request(sessionId = "vs_1", assistantId = "a1") {
  return GET(new Request("http://localhost:3000"), {
    params: Promise.resolve({ id: assistantId, sessionId }),
  });
}

function noStoreSessionWithTranscript() {
  const runtime = fakeVoiceRuntime({ ephemeral: true });
  runtime.inputFragments.push({ text: " Hi there", startMs: 1_000, endMs: 1_600 });
  runtime.outputFragments.push({ text: " Hello! How can I help?", startMs: 1_800, endMs: 3_000 });
  registerVoiceRuntime(runtime);
  return runtime;
}

describe("GET owner voice debug snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearVoiceRuntimeForTests();
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    getOwnedAssistant.mockResolvedValue({ id: "a1" });
  });

  it("requires a signed-in owner", async () => {
    noStoreSessionWithTranscript();
    getSession.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);

    getOwnedAssistant.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
  });

  it("does not expose a session through another assistant", async () => {
    noStoreSessionWithTranscript();
    getOwnedAssistant.mockResolvedValueOnce({ id: "a2" });
    expect((await request("vs_1", "a2")).status).toBe(404);
  });

  it("serves the in-memory no-store transcript uncached and writes nothing", async () => {
    noStoreSessionWithTranscript();
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.ephemeral).toBe(true);
    expect(body.exchanges).toEqual([
      expect.objectContaining({ kind: "live", question: "Hi there", answer: "Hello! How can I help?" }),
    ]);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("exposes nothing after the session terminates", async () => {
    const runtime = noStoreSessionWithTranscript();
    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: false });

    const response = await request();
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("Hi there");
    expect(runtime.inputFragments).toEqual([]);
    expect(runtime.liveExchanges).toEqual([]);
    // Operational row only exists when the mint inserted it; no content rows either way.
    expect(insertValues).not.toHaveBeenCalled();
  });
});
