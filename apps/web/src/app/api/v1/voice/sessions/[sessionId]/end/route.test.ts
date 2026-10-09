import type { MockControlChannel, MockRealtimeVoiceProvider } from "@chatai/voice/mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
/** Thenable so plain inserts and `.onConflictDoUpdate()` upserts both resolve. */
const insertValues = vi.fn<(row?: unknown) => Promise<undefined> & { onConflictDoUpdate: () => Promise<undefined> }>(() =>
  Object.assign(Promise.resolve(undefined), {
    onConflictDoUpdate: vi.fn(async () => undefined),
    onConflictDoNothing: vi.fn(async () => undefined),
  }),
);
const insert = vi.fn(() => ({ values: insertValues }));
const updateWhere = vi.fn(async () => undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));
const db = vi.fn(() => ({ select, insert, update }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    VOICE_PROVIDER: "mock",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    AI_API_KEY: "sk-should-never-leak",
    AI_BASE_URL: "https://api.openai.com/v1",
    WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
    WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
    WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
  },
}));

vi.mock("@/lib/cors", () => ({
  corsHeaders: {
    "Access-Control-Allow-Origin": "*",
  },
  jsonWithCors: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    Response.json(body, {
      status: init?.status ?? 200,
      headers: init?.headers,
    }),
}));

vi.mock("@/lib/policies/policy-response", () => ({
  policyViolationResponse: (violation: { status: number; message: string }) =>
    Response.json({ error: violation.message }, { status: violation.status }),
}));

const enforceWidgetRequest = vi.fn();
vi.mock("@/lib/policies/security-policy", () => ({
  SecurityPolicy: {
    fromAssistant: vi.fn(() => ({
      resolved: { widgetSigningSecret: null },
      enforceWidgetRequest,
    })),
  },
}));

vi.mock("@/lib/hosting/accounts", () => ({
  resolveBillableAccountForAssistant: vi.fn(async () => ({ id: "acct_1" })),
  checkHostingAccountAccess: vi.fn(() => ({ ok: true as const })),
}));

const usesApiKeyAuth = vi.fn(() => false);
vi.mock("@/lib/api-keys", () => ({
  usesApiKeyAuth: () => usesApiKeyAuth(),
}));

const getOwnedAssistantByRef = vi.fn();
vi.mock("@/lib/assistants", () => ({
  getOwnedAssistantByRef: (...args: unknown[]) => getOwnedAssistantByRef(...args),
}));

const authorizeV1 = vi.fn();
vi.mock("@/lib/authorize-v1", () => ({
  authorizeV1: (...args: unknown[]) => authorizeV1(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeApiKeyRateLimit: vi.fn(async () => ({ ok: true })),
}));

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => getSession(),
}));

vi.mock("@/lib/ai-config", () => ({
  resolveAssistantModels: vi.fn(async () => ({
    chat: {
      apiKey: "sk-should-never-leak",
      baseURL: "https://api.openai.com/v1",
      provider: "openai",
      model: "gpt",
    },
    embedding: {},
    billing: {},
  })),
}));

let idSeq = 0;
// Metering / quota run against a real database in metering-matrix.test.ts.
const admitVoiceSession = vi.fn();
const settleVoiceUsage = vi.fn<(...args: unknown[]) => Promise<null>>(async () => null);
const releaseVoiceAdmission = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
vi.mock("@/lib/voice/quota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/quota")>()),
  admitVoiceSession: (...args: unknown[]) => admitVoiceSession(...args),
  releaseVoiceAdmission: (...args: unknown[]) => releaseVoiceAdmission(...args),
  extendVoiceGrant: vi.fn(async () => 0),
}));
vi.mock("@/lib/voice/metering", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/metering")>()),
  settleVoiceUsage: (...args: unknown[]) => settleVoiceUsage(...args),
  checkpointVoiceUsage: vi.fn(async () => undefined),
  markVoiceConnected: vi.fn(async () => undefined),
  markVoiceProviderCreated: vi.fn(async () => undefined),
}));

function admissionOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    admission: {
      sessionId: "voice_sess_test_1",
      accountId: "acct_1",
      mode: "enforce" as const,
      quotaExempt: false,
      enforced: false,
      granted: 0,
      periodStart: new Date("2026-09-01T00:00:00Z"),
      ...overrides,
    },
  };
}

vi.mock("@/lib/ids", () => ({
  createId: vi.fn(() => {
    idSeq += 1;
    return `voice_sess_end_${idSeq}`;
  }),
}));

function assistantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "asst_internal",
    publicId: "asst_public",
    userId: "user_1",
    name: "Voice Bot",
    instructions: "Be helpful.",
    privacySettings: { storeConversations: true },
    voiceSettings: { enabled: true },
    securitySettings: {},
    modelSettings: {},
    ...overrides,
  };
}

async function mint(body: Record<string, unknown> = { source: "playground" }) {
  const { POST } = await import("../../route");
  const response = await POST(
    new Request("http://localhost:3000/api/v1/voice/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistantId: "asst_public", sdpOffer: "offer", capabilities: ["playback_gate"], ...body }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { sessionId: string; controlToken?: string };
}

async function heartbeat(sessionId: string, token: string) {
  delete (globalThis as Record<string, unknown>).__chatai_voice_last_heartbeat__;
  const { POST } = await import("../heartbeat/route");
  const response = await POST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  return ((await response.json()) as { state: string }).state;
}

async function end(sessionId: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
}

describe("POST /api/v1/voice/sessions/:sessionId/end", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    admitVoiceSession.mockResolvedValue(admissionOk());
    vi.resetModules();
    idSeq = 0;
    usesApiKeyAuth.mockReturnValue(false);
    enforceWidgetRequest.mockResolvedValue(null);
    selectLimit.mockResolvedValue([assistantRow()]);
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    const { clearVoiceRuntimeForTests, clearEndedVoiceSessionsForTests } = await import(
      "@/lib/voice"
    );
    clearVoiceRuntimeForTests();
    clearEndedVoiceSessionsForTests();
  });

  it("ends a minted session, finalizes usage, and unregisters runtime", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const { sessionId } = await mint();

    const response = await end(sessionId);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sessionId).toBe(sessionId);
    expect(body.usageFinalized).toBe(true);
    expect(body.usageIncomplete).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sk-should-never-leak");
    expect(getVoiceRuntime(sessionId)).toBeUndefined();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ended", billableSeconds: 0 }),
    );
  });

  it("returns 404 for unknown sessions", async () => {
    const response = await end("missing");
    expect(response.status).toBe(404);
  });

  it("API key that does not own the assistant cannot end the session", async () => {
    const { sessionId } = await mint();
    usesApiKeyAuth.mockReturnValue(true);
    authorizeV1.mockResolvedValueOnce({ ok: true, userId: "attacker", apiKeyId: "key_x" });
    getOwnedAssistantByRef.mockResolvedValueOnce(null);

    const response = await end(sessionId);
    expect(response.status).toBe(404);
    const { getVoiceRuntime } = await import("@/lib/voice");
    expect(getVoiceRuntime(sessionId)).toBeDefined();
  });

  it("widget session cannot be ended by claiming playground source", async () => {
    const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
    enforceWidgetRequest.mockClear();

    const response = await end(sessionId, { source: "playground", visitorId: "visitor01" });
    expect(response.status).toBe(200);
    // Authorization used the minted source, not the body claim.
    expect(enforceWidgetRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ source: "widget" }),
    );
  });

  it("rejects a different visitor ending a widget session", async () => {
    const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
    const response = await end(sessionId, { visitorId: "visitor99" });
    expect(response.status).toBe(403);
  });

  it("provider-initiated close finalizes and wipes runtime without a client end", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const { sessionId } = await mint();
    const runtime = getVoiceRuntime(sessionId)!;
    runtime.inputTranscript = "private words";

    const channel = runtime.channel as unknown as {
      emit: (e: unknown) => void;
    };
    channel.emit({ type: "session.closed", reason: "remote_hangup", usageSeconds: 42 });
    await runtime.terminating;

    expect(getVoiceRuntime(sessionId)).toBeUndefined();
    expect(runtime.inputTranscript).toBe("");
    expect(runtime.usageFinalized).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ended", billableSeconds: 42 }),
    );
  });

  it("a sideband drop is not the end of the call: control re-attaches and the call continues", async () => {
    const { getVoiceRuntime, waitForVoiceControlIdle } = await import("@/lib/voice");
    const { sessionId } = await mint();
    const runtime = getVoiceRuntime(sessionId)!;
    const channel = runtime.channel as unknown as MockControlChannel;

    channel.setUsageSeconds(7);
    channel.simulateSidebandDrop();
    await waitForVoiceControlIdle(runtime);

    expect(getVoiceRuntime(sessionId)).toBe(runtime);
    expect(runtime.control).toMatchObject({ state: "attached", attempts: 1, possibleLoss: false });
    expect(runtime.counters).toMatchObject({ controlDisconnects: 1, controlRecoveries: 1 });

    channel.setUsageSeconds(12);
    const body = await (await end(sessionId)).json();
    expect(body).toMatchObject({ usageFinalized: true, billableSeconds: 12 });
  });

  it("a sideband that cannot be re-attached ends the call: hangup, estimated usage, sideband_lost", async () => {
    const { getVoiceRuntime, setVoiceControlSettingsForTests, waitForVoiceControlIdle } = await import(
      "@/lib/voice"
    );
    setVoiceControlSettingsForTests({ reattachOffsetsMs: [0, 5, 10], reattachWindowMs: 60, attachTimeoutMs: 20 });
    try {
      const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
      const runtime = getVoiceRuntime(sessionId)!;
      const provider = runtime.provider as MockRealtimeVoiceProvider;
      provider.hooks.reattach = "refuse";
      const channel = runtime.channel as unknown as MockControlChannel;

      channel.setUsageSeconds(7);
      channel.simulateSidebandDrop();
      await waitForVoiceControlIdle(runtime);
      await runtime.terminating;

      expect(getVoiceRuntime(sessionId)).toBeUndefined();
      expect(provider.hangups).toEqual([runtime.providerSessionId]);
      expect(runtime.control).toMatchObject({ state: "lost", attempts: 3 });
      expect(runtime.usageIncomplete).toBe(true);
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", billableSeconds: 7, errorCode: "sideband_lost" }),
      );
      expect(settleVoiceUsage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId, measurement: "provider_checkpoint", providerSeconds: 7 }),
      );
      // Visitors only learn that Voice disconnected.
      const late = await (await end(sessionId, { visitorId: "visitor01" })).json();
      expect(late.endReason).toBe("disconnected");
    } finally {
      setVoiceControlSettingsForTests(null);
    }
  });

  it("same runtime: heartbeats read healthy → degraded while re-attaching → healthy, same call", async () => {
    const { getVoiceRuntime, waitForVoiceControlIdle } = await import("@/lib/voice");
    const { sessionId, controlToken } = await mint({
      source: "widget",
      visitorId: "visitor01",
      capabilities: ["heartbeat", "playback_gate"],
    });
    expect(controlToken).toEqual(expect.any(String));
    vi.useFakeTimers();
    try {
      const runtime = getVoiceRuntime(sessionId)!;
      const provider = runtime.provider as MockRealtimeVoiceProvider;
      const channel = runtime.channel as unknown as MockControlChannel;
      const states = [await heartbeat(sessionId, controlToken!)];

      provider.hooks.reattach = "refuse";
      channel.simulateSidebandDrop();
      await vi.advanceTimersByTimeAsync(1_500);
      states.push(await heartbeat(sessionId, controlToken!));
      provider.hooks.reattach = "ok";
      await vi.advanceTimersByTimeAsync(1_000);
      await waitForVoiceControlIdle(runtime);
      states.push(await heartbeat(sessionId, controlToken!));

      expect(states).toEqual(["healthy", "degraded", "healthy"]);
      expect(getVoiceRuntime(sessionId)).toBe(runtime);
      expect(runtime.control).toMatchObject({ state: "attached" });
      expect(provider.hangups).toEqual([]);
      expect(settleVoiceUsage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a provider session gone during re-attach ends at once instead of retrying", async () => {
    const { getVoiceRuntime, waitForVoiceControlIdle } = await import("@/lib/voice");
    const { sessionId } = await mint();
    const runtime = getVoiceRuntime(sessionId)!;
    (runtime.provider as MockRealtimeVoiceProvider).hooks.reattach = "gone";
    (runtime.channel as unknown as MockControlChannel).simulateSidebandDrop();
    await waitForVoiceControlIdle(runtime);
    await runtime.terminating;
    expect(runtime.control).toMatchObject({ state: "lost", attempts: 1 });
    expect(getVoiceRuntime(sessionId)).toBeUndefined();
  });

  it("a lookup interrupted by the drop gets a neutral fallback once control is back", async () => {
    const { getVoiceRuntime, waitForVoiceControlIdle } = await import("@/lib/voice");
    const { CONTROL_INTERRUPTED_COMMENTARY } = await import("@/lib/voice/control-plane");
    const { sessionId } = await mint();
    const runtime = getVoiceRuntime(sessionId)!;
    const channel = runtime.channel as unknown as MockControlChannel;
    const appended = vi.spyOn(channel, "appendCommentary");

    // Collecting: waits for the utterance transcript that the drop will cut off.
    const delegationId = channel.simulateDelegationCreated();
    channel.simulateSidebandDrop();
    expect(runtime.turns[0]).toMatchObject({ status: "superseded", supersededBy: "control_lost" });

    await waitForVoiceControlIdle(runtime);
    await vi.waitFor(() =>
      expect(appended).toHaveBeenCalledWith(delegationId, CONTROL_INTERRUPTED_COMMENTARY),
    );
    expect(appended).toHaveBeenCalledTimes(1);
  });

  it("after a gap longer than the replay backlog, the live model is told to stop waiting", async () => {
    const { getVoiceRuntime, waitForVoiceControlIdle } = await import("@/lib/voice");
    const { CONTROL_GAP_INSTRUCTIONS } = await import("@/lib/voice/control-plane");
    const { sessionId } = await mint();
    vi.useFakeTimers();
    try {
      const runtime = getVoiceRuntime(sessionId)!;
      const provider = runtime.provider as MockRealtimeVoiceProvider;
      const channel = runtime.channel as unknown as MockControlChannel;
      const instructions = vi.spyOn(channel, "appendInstructions");
      provider.hooks.reattach = "refuse";
      channel.simulateSidebandDrop();
      // Attempts at 0 / 1 / 2 s fail; the one at 4 s succeeds.
      await vi.advanceTimersByTimeAsync(3_500);
      expect(runtime.control).toMatchObject({ state: "reattaching", attempts: 3 });
      provider.hooks.reattach = "ok";
      await vi.advanceTimersByTimeAsync(1_000);
      await waitForVoiceControlIdle(runtime);

      expect(runtime.control).toMatchObject({ state: "attached", attempts: 4, possibleLoss: true });
      expect(runtime.control!.lastGapMs).toBeGreaterThanOrEqual(4_000);
      expect(instructions).toHaveBeenCalledWith(CONTROL_GAP_INSTRUCTIONS, null);
      expect(getVoiceRuntime(sessionId)).toBe(runtime);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a replayed delegation is never run twice", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const { sessionId } = await mint();
    const runtime = getVoiceRuntime(sessionId)!;
    const channel = runtime.channel as unknown as MockControlChannel;
    const delegationId = channel.simulateDelegationCreated();
    channel.emit({ type: "delegation.created", delegationId, offsetMs: 0 });
    expect(runtime.turns).toHaveLength(1);
    expect(runtime.counters.delegations).toBe(1);
  });

  it("a widget session ChatAI ended for usage answers a late end with a neutral endReason", async () => {
    const { getVoiceRuntime, terminateVoiceSession } = await import("@/lib/voice");
    const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
    const runtime = getVoiceRuntime(sessionId)!;
    runtime.endReason = "usage_limit";
    await terminateVoiceSession(runtime, {
      reason: "close_requested",
      requestProviderClose: true,
      errorCode: "usage_limit",
    });
    expect(getVoiceRuntime(sessionId)).toBeUndefined();

    const response = await end(sessionId, { visitorId: "visitor01" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { endReason: string | null; sessionId: string };
    expect(body).toMatchObject({ sessionId, endReason: "voice_unavailable" });
    // Visitors never see usage, quota, plan details or remaining minutes.
    expect(JSON.stringify(body)).not.toMatch(/usage_limit|remaining|voiceSecondsLimit|plan|quota|minute/i);
  });

  it("a live widget session ended by the visitor after a usage close also reads as neutral", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
    getVoiceRuntime(sessionId)!.endReason = "usage_limit";
    const response = await end(sessionId, { visitorId: "visitor01" });
    const body = (await response.json()) as { endReason: string | null };
    expect(body.endReason).toBe("voice_unavailable");
  });

  it("the owner's playground keeps the administrative endReason", async () => {
    const { getVoiceRuntime, terminateVoiceSession } = await import("@/lib/voice");
    const { sessionId } = await mint({ source: "playground" });
    const runtime = getVoiceRuntime(sessionId)!;
    runtime.endReason = "usage_limit";
    await terminateVoiceSession(runtime, {
      reason: "close_requested",
      requestProviderClose: true,
      errorCode: "usage_limit",
    });
    const response = await end(sessionId, { source: "playground" });
    const body = (await response.json()) as { endReason: string | null };
    expect(body.endReason).toBe("usage_limit");
  });

  it("the ended-session answer keeps the original authorization (visitor mismatch)", async () => {
    const { getVoiceRuntime, terminateVoiceSession } = await import("@/lib/voice");
    const { sessionId } = await mint({ source: "widget", visitorId: "visitor01" });
    await terminateVoiceSession(getVoiceRuntime(sessionId)!, {
      reason: "close_requested",
      requestProviderClose: true,
    });
    const response = await end(sessionId, { visitorId: "visitor99" });
    expect(response.status).toBe(403);
  });

  it("a new widget mint supersedes (and settles) the same visitor's previous session", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const first = await mint({ source: "widget", visitorId: "visitor01" });
    const second = await mint({ source: "widget", visitorId: "visitor01" });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(getVoiceRuntime(first.sessionId)).toBeUndefined();
    expect(getVoiceRuntime(second.sessionId)).toBeDefined();
    expect(settleVoiceUsage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: first.sessionId }),
    );

    const response = await end(first.sessionId, { visitorId: "visitor01" });
    expect(((await response.json()) as { endReason: string }).endReason).toBe("superseded");
  });

  it("another visitor's widget session is not superseded", async () => {
    const { getVoiceRuntime } = await import("@/lib/voice");
    const first = await mint({ source: "widget", visitorId: "visitor01" });
    await mint({ source: "widget", visitorId: "visitor02" });
    expect(getVoiceRuntime(first.sessionId)).toBeDefined();
  });
});
