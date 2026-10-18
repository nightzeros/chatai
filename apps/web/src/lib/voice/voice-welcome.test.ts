import type { AppendResult } from "@chatai/voice";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/ai-config", () => ({ resolveAssistantModels: vi.fn() }));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));
vi.mock("@/lib/hosting/shadow-meter", () => ({
  recordShadowUsages: vi.fn(async () => 0),
}));
vi.mock("@/lib/ids", () => ({ createId: () => "id_welcome" }));

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { endVoiceGate, setVoiceGate, voiceGateOf } from "./turn-gate";
import {
  clearWelcomeCloseTimerForTests,
  speakVoiceWelcome,
} from "./voice-welcome";

describe("speakVoiceWelcome", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends speakable welcome once, opens the gate, then closes after settle", async () => {
    vi.useFakeTimers();
    const appendCommentary = vi.fn(async () => ({ ok: true as const, eventId: "e1" }));
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "Hello **there** — ask about [Ada](https://x.y)!",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: {
        providerSessionId: "prov_1",
        subscribe: () => () => undefined,
        appendCommentary,
        appendThinking: vi.fn(),
        appendInstructions: vi.fn(),
        close: vi.fn(async () => ({
          ok: true as const,
          reason: "close_requested" as const,
          usageSeconds: 1,
        })),
      },
    });
    voiceGateOf(session);

    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).toBe(true);
    expect(appendCommentary).toHaveBeenCalledTimes(1);
    expect(appendCommentary).toHaveBeenCalledWith(null, "Hello there — ask about Ada!");
    expect(session.gate?.decision).toMatchObject({ state: "open", reason: "system" });
    expect(session.history).toEqual([{ role: "assistant", content: "Hello there — ask about Ada!" }]);

    await speakVoiceWelcome(session);
    expect(appendCommentary).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(session.gate?.decision).toMatchObject({ state: "closed", reason: "system" });

    clearWelcomeCloseTimerForTests(session);
    endVoiceGate(session);
  });

  it("skips empty welcome and does not open the gate", async () => {
    const appendCommentary = vi.fn(async () => ({ ok: true as const, eventId: "e1" }));
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "   ",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: {
        providerSessionId: "prov_1",
        subscribe: () => () => undefined,
        appendCommentary,
        appendThinking: vi.fn(),
        appendInstructions: vi.fn(),
        close: vi.fn(async () => ({
          ok: true as const,
          reason: "close_requested" as const,
          usageSeconds: 1,
        })),
      },
    });
    voiceGateOf(session);

    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).toBe(true);
    expect(appendCommentary).not.toHaveBeenCalled();
    expect(session.gate?.decision.state).toBe("closed");
    endVoiceGate(session);
  });

  it("does not re-speak on a second session.started style call (reattach safety)", async () => {
    const appendCommentary = vi.fn(async () => ({ ok: true as const, eventId: "e1" }));
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "Welcome aboard.",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: {
        providerSessionId: "prov_1",
        subscribe: () => () => undefined,
        appendCommentary,
        appendThinking: vi.fn(),
        appendInstructions: vi.fn(),
        close: vi.fn(async () => ({
          ok: true as const,
          reason: "close_requested" as const,
          usageSeconds: 1,
        })),
      },
    });

    await speakVoiceWelcome(session);
    session.welcomeSpoken = true;
    await speakVoiceWelcome(session);
    expect(appendCommentary).toHaveBeenCalledTimes(1);
    clearWelcomeCloseTimerForTests(session);
    endVoiceGate(session);
  });

  it("does not close a social gate when the welcome settle timer fires", async () => {
    vi.useFakeTimers();
    const appendCommentary = vi.fn(async () => ({ ok: true as const, eventId: "e1" }));
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "Welcome.",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: {
        providerSessionId: "prov_1",
        subscribe: () => () => undefined,
        appendCommentary,
        appendThinking: vi.fn(),
        appendInstructions: vi.fn(),
        close: vi.fn(async () => ({
          ok: true as const,
          reason: "close_requested" as const,
          usageSeconds: 1,
        })),
      },
    });
    voiceGateOf(session);

    await speakVoiceWelcome(session);
    expect(session.gate?.decision).toMatchObject({ state: "open", reason: "system" });

    // Small talk during the welcome delay: social open, no utterance claimed yet.
    setVoiceGate(session, "open", "social");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(session.gate?.decision).toMatchObject({ state: "open", reason: "social" });

    clearWelcomeCloseTimerForTests(session);
    endVoiceGate(session);
  });

  it("leaves welcomeSpoken false on transient channel failure so a later call can retry", async () => {
    const appendCommentary = vi.fn(async (): Promise<AppendResult> => ({
      ok: false,
      reason: "session_closed",
    }));
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "Welcome aboard.",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: {
        providerSessionId: "prov_1",
        subscribe: () => () => undefined,
        appendCommentary,
        appendThinking: vi.fn(),
        appendInstructions: vi.fn(),
        close: vi.fn(async () => ({
          ok: true as const,
          reason: "close_requested" as const,
          usageSeconds: 1,
        })),
      },
    });

    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).not.toBe(true);
    expect(appendCommentary).toHaveBeenCalledTimes(1);

    appendCommentary.mockResolvedValueOnce({ ok: true, eventId: "e2" });
    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).toBe(true);
    expect(appendCommentary).toHaveBeenCalledTimes(2);

    clearWelcomeCloseTimerForTests(session);
    endVoiceGate(session);
  });

  it("leaves welcomeSpoken false when the channel is missing so a later call can retry", async () => {
    const session = fakeVoiceRuntime({
      assistant: {
        id: "a1",
        welcomeMessage: "Welcome aboard.",
        instructions: null,
        hallucinationMode: "balanced",
        ragSettings: null,
        modelSettings: null,
        hostingAccount: { id: "acct_1", status: "active" } as never,
      },
      channel: null,
    });

    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).not.toBe(true);

    const appendCommentary = vi.fn(async () => ({ ok: true as const, eventId: "e1" }));
    session.channel = {
      providerSessionId: "prov_1",
      subscribe: () => () => undefined,
      appendCommentary,
      appendThinking: vi.fn(),
      appendInstructions: vi.fn(),
      close: vi.fn(async () => ({
        ok: true as const,
        reason: "close_requested" as const,
        usageSeconds: 1,
      })),
    };

    await speakVoiceWelcome(session);
    expect(session.welcomeSpoken).toBe(true);
    expect(appendCommentary).toHaveBeenCalledTimes(1);

    clearWelcomeCloseTimerForTests(session);
    endVoiceGate(session);
  });
});
