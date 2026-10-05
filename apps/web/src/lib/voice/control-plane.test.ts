import { MockRealtimeVoiceProvider, type MockControlChannel } from "@chatai/voice/mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ BETTER_AUTH_SECRET: "test-auth-secret-not-real-0123456789" as string | undefined }));

vi.mock("@/lib/db", () => ({
  db: () => ({
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({ values: async () => undefined }),
  }),
}));
vi.mock("@/lib/env", () => ({ env }));
vi.mock("@/lib/ai-config", () => ({ resolveAssistantModels: vi.fn() }));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));
const settleVoiceUsage = vi.fn(async () => null);
vi.mock("./metering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./metering")>()),
  settleVoiceUsage: (...args: unknown[]) => settleVoiceUsage(...(args as [])),
}));

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { setVoiceClockForTests } from "./clock";
import {
  IDLE_CHECKIN_INSTRUCTIONS,
  MAX_DURATION_WARNING_INSTRUCTIONS,
  recordVoiceHeartbeat,
  setVoiceSupervisionAutoTickForTests,
  startVoiceSupervision,
  tickVoiceSupervision,
  voiceControlHealth,
} from "./control-plane";
import { CONTROL_TOKEN_TTL_MS, createVoiceControlToken, verifyVoiceControlToken } from "./control-token";
import {
  armVoiceRuntimeTtl,
  clearEndedVoiceSessionsForTests,
  getEndedVoiceSession,
  publicEndResult,
  publicVoiceEndReason,
  VOICE_RUNTIME_MAX_MS,
} from "./lifecycle";
import { sanitizeVoiceLogFields } from "./observability";
import {
  clearVoiceRuntimeForTests,
  getVoiceRuntime,
  registerVoiceRuntime,
  type VoiceRuntimeSession,
  type VoiceTurn,
} from "./session-runtime";
import { superviseSideband } from "./sideband-supervisor";

const T0 = 1_800_000_000_000;
let now = T0;

async function liveSession(
  options: { heartbeatCapable?: boolean; startedAt?: number; source?: "widget" | "playground" } = {},
) {
  const provider = new MockRealtimeVoiceProvider();
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: {
      model: "gpt-live-1",
      voice: "marin",
      instructions: "",
      delegationMode: "client",
    } as Parameters<typeof provider.createWebRtcSession>[0]["sessionConfig"],
  });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  const session: VoiceRuntimeSession = fakeVoiceRuntime({
    providerSessionId: created.providerSessionId,
    provider,
    channel,
    source: options.source ?? "widget",
    startedAt: new Date(options.startedAt ?? now),
  });
  superviseSideband(session, channel);
  registerVoiceRuntime(session);
  startVoiceSupervision(session, { heartbeatCapable: options.heartbeatCapable ?? false });
  const instructions = vi.spyOn(channel, "appendInstructions");
  return { session, channel, provider, instructions };
}

beforeEach(() => {
  now = T0;
  setVoiceClockForTests(() => now);
  setVoiceSupervisionAutoTickForTests(false);
  clearVoiceRuntimeForTests();
  clearEndedVoiceSessionsForTests();
  settleVoiceUsage.mockClear();
});

afterEach(() => {
  setVoiceClockForTests(null);
  setVoiceSupervisionAutoTickForTests(true);
});

describe("idle supervision (180 s + 30 s)", () => {
  it("checks in after 180 s of silence and ends 30 s later with a hangup", async () => {
    const { session, provider, instructions } = await liveSession();
    await tickVoiceSupervision(session, T0 + 179_999);
    expect(instructions).not.toHaveBeenCalled();

    await tickVoiceSupervision(session, T0 + 180_000);
    expect(instructions).toHaveBeenCalledWith(IDLE_CHECKIN_INSTRUCTIONS, null);
    await tickVoiceSupervision(session, T0 + 209_999);
    expect(session.terminating).toBeNull();

    await tickVoiceSupervision(session, T0 + 210_000);
    const result = await session.terminating!;
    expect(result).toMatchObject({ endReason: "idle", usageFinalized: true });
    expect(provider.hangups).toEqual([session.providerSessionId]);
    expect(getVoiceRuntime(session.sessionId)).toBeUndefined();
  });

  it("visitor speech after the check-in keeps the call alive", async () => {
    const { session, channel, instructions } = await liveSession();
    await tickVoiceSupervision(session, T0 + 180_000);
    expect(instructions).toHaveBeenCalledTimes(1);

    now = T0 + 195_000;
    channel.simulateInputTranscript("still here");
    await tickVoiceSupervision(session, T0 + 215_000);
    expect(session.terminating).toBeNull();
    expect(session.supervision).toMatchObject({ idleSince: T0 + 195_000, idleWarnedAt: null });
  });

  it("assistant speech alone never resets idle", async () => {
    const { session, channel } = await liveSession();
    now = T0 + 100_000;
    channel.simulateOutputTranscript("Anything else I can help with?");
    expect(session.supervision?.idleSince).toBe(T0);
  });

  it("pauses while a lookup is in flight", async () => {
    const { session, instructions } = await liveSession();
    session.turns.push({ status: "retrieving" } as VoiceTurn);
    await tickVoiceSupervision(session, T0 + 400_000);
    expect(instructions).not.toHaveBeenCalled();
    expect(session.supervision?.idleSince).toBe(T0 + 400_000);
  });
});

describe("heartbeat supervision", () => {
  it("a heartbeat-capable client that goes silent for 45 s is ended (widget sees disconnected)", async () => {
    const { session, provider } = await liveSession({ heartbeatCapable: true });
    now = T0 + 20_000;
    recordVoiceHeartbeat(session);
    await tickVoiceSupervision(session, T0 + 64_999);
    expect(session.terminating).toBeNull();

    await tickVoiceSupervision(session, T0 + 65_000);
    const result = await session.terminating!;
    expect(result.endReason).toBe("heartbeat_lost");
    expect(provider.hangups).toHaveLength(1);
    const ended = getEndedVoiceSession(session.sessionId)!;
    expect(publicEndResult(ended.result, "widget").endReason).toBe("disconnected");
  });

  it("clients that never declared heartbeats are never ended for missing ones", async () => {
    const { session } = await liveSession({ heartbeatCapable: false });
    await tickVoiceSupervision(session, T0 + 120_000);
    expect(session.terminating).toBeNull();
  });

  it("reports control health for the heartbeat route", async () => {
    const { session } = await liveSession();
    expect(voiceControlHealth(session)).toBe("healthy");
    session.control = {
      state: "reattaching",
      lostAt: T0,
      attempts: 1,
      lastGapMs: null,
      possibleLoss: false,
      interruptedDelegations: [],
    };
    expect(voiceControlHealth(session)).toBe("degraded");
    session.control.state = "lost";
    expect(voiceControlHealth(session)).toBe("ended");
  });
});

describe("max duration (60 min)", () => {
  it("warns once about 30 s before the cap", async () => {
    const startedAt = T0 - (VOICE_RUNTIME_MAX_MS - 30_000);
    const { session, instructions } = await liveSession({ startedAt });
    await tickVoiceSupervision(session, T0 - 1);
    expect(instructions).not.toHaveBeenCalledWith(MAX_DURATION_WARNING_INSTRUCTIONS, null);
    await tickVoiceSupervision(session, T0);
    await tickVoiceSupervision(session, T0 + 1_000);
    const warnings = instructions.mock.calls.filter((call) => call[0] === MAX_DURATION_WARNING_INSTRUCTIONS);
    expect(warnings).toHaveLength(1);
  });

  it("the runtime cap ends the call with endReason max_duration", async () => {
    const { session } = await liveSession();
    armVoiceRuntimeTtl(session, 5);
    await vi.waitFor(() => expect(session.terminating).not.toBeNull());
    expect((await session.terminating!).endReason).toBe("max_duration");
  });
});

describe("control token", () => {
  it("authorizes exactly one session and carries the visitor binding", () => {
    const token = createVoiceControlToken({ sessionId: "vs_1", visitorId: "visitor01", now: T0 })!;
    expect(verifyVoiceControlToken(token, "vs_1", T0 + 1_000)).toEqual({ ok: true, visitorId: "visitor01" });
    expect(verifyVoiceControlToken(token, "vs_2", T0 + 1_000)).toEqual({ ok: false });
  });

  it("rejects tampered, malformed and expired tokens", () => {
    const token = createVoiceControlToken({ sessionId: "vs_1", visitorId: null, now: T0 })!;
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "vs_1", v: null, e: T0 + 10 * CONTROL_TOKEN_TTL_MS })).toString(
      "base64url",
    );
    expect(verifyVoiceControlToken(`${forged}.${signature}`, "vs_1", T0)).toEqual({ ok: false });
    expect(verifyVoiceControlToken(`${payload}.${signature}x`, "vs_1", T0)).toEqual({ ok: false });
    expect(verifyVoiceControlToken(`${payload}.${signature}.extra`, "vs_1", T0)).toEqual({ ok: false });
    expect(verifyVoiceControlToken("", "vs_1", T0)).toEqual({ ok: false });
    expect(verifyVoiceControlToken(token, "vs_1", T0 + CONTROL_TOKEN_TTL_MS)).toEqual({ ok: false });
  });

  it("is unavailable without a signing secret", () => {
    const saved = env.BETTER_AUTH_SECRET;
    env.BETTER_AUTH_SECRET = undefined;
    try {
      expect(createVoiceControlToken({ sessionId: "vs_1", visitorId: null })).toBeNull();
      expect(verifyVoiceControlToken("a.b", "vs_1")).toEqual({ ok: false });
    } finally {
      env.BETTER_AUTH_SECRET = saved;
    }
  });
});

describe("operator logs and public end reasons", () => {
  it("keeps ids, codes and numbers; redacts free text and keys", () => {
    expect(
      sanitizeVoiceLogFields({
        sessionId: "voice_sess_1",
        code: "browser_command_lock_rejected",
        providerStatus: 400,
        elapsed: Number.NaN,
        message: "Unknown parameter: 'session.client'",
        key: "sk-live-abc123",
        url: "https://api.example.com/v1?key=x",
        ok: true,
        missing: undefined,
      }),
    ).toEqual({
      sessionId: "voice_sess_1",
      code: "browser_command_lock_rejected",
      providerStatus: 400,
      elapsed: null,
      message: "[redacted]",
      key: "[redacted]",
      url: "[redacted]",
      ok: true,
    });
  });

  it("widget visitors only see neutral end reasons", () => {
    expect(publicVoiceEndReason("usage_limit")).toBe("voice_unavailable");
    expect(publicVoiceEndReason("heartbeat_lost")).toBe("disconnected");
    expect(publicVoiceEndReason("control_lost")).toBe("disconnected");
    expect(publicVoiceEndReason("idle")).toBe("idle");
    expect(publicVoiceEndReason("max_duration")).toBe("max_duration");
    expect(publicVoiceEndReason("superseded")).toBe("superseded");
    expect(publicVoiceEndReason(null)).toBeNull();
  });
});
