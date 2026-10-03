import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveEffectiveVoicePersistence,
  type EffectiveVoicePersistence,
} from "@chatai/database";

vi.mock("@/lib/db", () => ({
  db: () => ({
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
  }),
}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/ai-config", () => ({ resolveAssistantModels: vi.fn() }));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { armVoiceRuntimeTtl } from "./lifecycle";
import {
  clearVoiceRuntimeForTests,
  discardConversationalBuffers,
  getVoiceRuntime,
  registerVoiceRuntime,
  type VoiceRuntimeSession,
} from "./session-runtime";

function persistence(storeConversations: boolean): EffectiveVoicePersistence {
  return resolveEffectiveVoicePersistence(
    { storeConversations },
    { enabled: true, saveTranscripts: true, saveAudioRecordings: true },
  );
}

function fakeRuntime(overrides: Partial<VoiceRuntimeSession> = {}): VoiceRuntimeSession {
  const close = vi.fn(async () => ({
    ok: true as const,
    reason: "expired" as const,
    usageSeconds: 30,
  }));
  return fakeVoiceRuntime({
    source: "widget",
    inputTranscript: "secret in",
    outputTranscript: "secret out",
    inputFragments: [{ text: "secret in", startMs: 0, endMs: 100 }],
    history: [{ role: "user", content: "secret history" }],
    channel: {
      providerSessionId: "prov_1",
      subscribe: () => () => undefined,
      appendCommentary: vi.fn(),
      appendThinking: vi.fn(),
      appendInstructions: vi.fn(),
      close,
    },
    ...overrides,
  });
}

describe("voice runtime privacy + lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearVoiceRuntimeForTests();
  });

  it("forces ephemeral + saves off under no-store", () => {
    expect(persistence(false)).toMatchObject({
      storeConversations: false,
      saveTranscripts: false,
      saveAudioRecordings: false,
      ephemeral: true,
    });
  });

  it("discards transcript buffers on terminate", () => {
    const session = fakeRuntime();
    discardConversationalBuffers(session);
    expect(session.inputTranscript).toBe("");
    expect(session.outputTranscript).toBe("");
    expect(session.inputFragments).toEqual([]);
    expect(session.history).toEqual([]);
    expect(session.turns).toEqual([]);
  });

  it("TTL closes abandoned sessions and wipes buffers", async () => {
    vi.useFakeTimers();
    const session = fakeRuntime();
    registerVoiceRuntime(session);
    armVoiceRuntimeTtl(session, 1_000);

    await vi.advanceTimersByTimeAsync(1_001);
    await session.terminating;

    expect(session.channel).toBeNull();
    expect(getVoiceRuntime("vs_1")).toBeUndefined();
    expect(session.inputTranscript).toBe("");
    expect(session.history).toEqual([]);
    expect(session.usageSeconds).toBe(30);
  });
});
