import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
/** History rows, newest first (the loader reverses them). */
const historyLimit = vi.fn(
  async () => [] as Array<{ role: string; content: string; outcome?: string | null }>,
);
const selectOrderBy = vi.fn(() => ({ limit: historyLimit }));
const selectWhere = vi.fn(() => ({ limit: selectLimit, orderBy: selectOrderBy }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
/** Thenable so plain inserts and `.onConflictDoUpdate()` upserts both resolve. */
const insertResult = (done: Promise<undefined> = Promise.resolve(undefined)) =>
  Object.assign(done, {
    onConflictDoUpdate: vi.fn(async () => undefined),
    onConflictDoNothing: vi.fn(async () => undefined),
  });
const insertValues = vi.fn<(row?: unknown) => Promise<undefined> & { onConflictDoUpdate: () => Promise<undefined> }>(
  () => insertResult(),
);
const insert = vi.fn(() => ({ values: insertValues }));
const updateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
const update = vi.fn(() => ({ set: updateSet }));
const db = vi.fn(() => ({ select, insert, update }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    VOICE_PROVIDER: "mock",
    VOICE_OPENAI_API_KEY: undefined as string | undefined,
    VOICE_OPENAI_BASE_URL: "https://api.openai.com",
    AI_API_KEY: "sk-should-never-leak",
    AI_BASE_URL: "https://api.openai.com/v1",
    WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
    WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
    WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
    BETTER_AUTH_SECRET: "test-auth-secret-not-real-0123456789",
    VOICE_RECORDING_SPOOL_DIR: `${process.env.TMPDIR ?? "/tmp"}/chatai-mint-test-spool`,
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
      resolved: { widgetSigningSecret: "server-secret-only" as string | null },
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

vi.mock("@/lib/assistants", () => ({
  getOwnedAssistantByRef: vi.fn(),
}));

const authorizeV1 = vi.fn();
vi.mock("@/lib/authorize-v1", () => ({
  authorizeV1: (...args: unknown[]) => authorizeV1(...args),
}));

vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeApiKeyRateLimit: vi.fn(async () => ({ ok: true })),
}));

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => getSession(),
}));

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
  createId: vi.fn(() => "voice_sess_test_1"),
}));

const resolveAssistantModels = vi.fn();
vi.mock("@/lib/ai-config", () => ({
  resolveAssistantModels: (...args: unknown[]) => resolveAssistantModels(...args),
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

function mintRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/v1/voice/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ assistantId: "asst_public", sdpOffer: "v=0\r\noffer", ...body }),
  });
}

describe("POST /api/v1/voice/sessions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    admitVoiceSession.mockResolvedValue(admissionOk());
    vi.resetModules();
    usesApiKeyAuth.mockReturnValue(false);
    enforceWidgetRequest.mockResolvedValue(null);
    selectLimit.mockResolvedValue([assistantRow()]);
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    resolveAssistantModels.mockResolvedValue({
      chat: {
        apiKey: "sk-should-never-leak",
        baseURL: "https://api.openai.com/v1",
        provider: "openai",
        model: "gpt",
      },
      embedding: {},
      billing: {},
    });
    const { clearVoiceRuntimeForTests, resetVoiceShutdownForTests, setVoiceProviderForTests } = await import(
      "@/lib/voice"
    );
    clearVoiceRuntimeForTests();
    resetVoiceShutdownForTests();
    setVoiceProviderForTests(null);
    const { setObjectStorageForTests } = await import("@/lib/storage/object-storage");
    setObjectStorageForTests(null);
  });

  async function withObjectStorage() {
    const { setObjectStorageForTests } = await import("@/lib/storage/object-storage");
    const { createMemoryObjectStorage } = await import("@/lib/storage/memory");
    setObjectStorageForTests(createMemoryObjectStorage());
  }

  const recordingAssistant = (voice: Record<string, unknown> = {}) =>
    assistantRow({ voiceSettings: { enabled: true, saveAudioRecordings: true, ...voice } });

  it("recording: widget mint without consent is rejected before any provider session or row", async () => {
    await withObjectStorage();
    selectLimit.mockResolvedValueOnce([recordingAssistant()]);
    const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
    const provider = new MockRealtimeVoiceProvider();
    const create = vi.spyOn(provider, "createWebRtcSession");
    const { setVoiceProviderForTests } = await import("@/lib/voice");
    setVoiceProviderForTests(provider);

    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/consent/i);
    expect(create).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("recording: consent is stamped, the session is recorded, and transcripts-off still gets a conversation", async () => {
    await withObjectStorage();
    selectLimit.mockResolvedValueOnce([recordingAssistant({ saveTranscripts: false })]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest(
        { visitorId: "visitor01", source: "widget", recordingConsent: true },
        { Origin: "https://example.com" },
      ),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ recording: true, transcriptSaved: false, ephemeral: false });
    expect(body.conversationId).toBeTruthy();

    const rows = insertValues.mock.calls.map((call) => (call as unknown[])[0] as Record<string, unknown>);
    const sessionRow = rows.find((row) => row.providerSessionId !== undefined);
    expect(sessionRow?.recordingConsentAt).toBeInstanceOf(Date);
    const recordingRow = rows.find((row) => row.kind === "mix");
    expect(recordingRow).toMatchObject({ status: "pending", contentType: "audio/webm" });
    expect(String(recordingRow?.storageKey)).toMatch(/^voice\/asst_internal\/.+\.webm$/);
    expect(JSON.stringify(body)).not.toContain(String(recordingRow?.storageKey));

    const { getVoiceRuntime, finishVoiceRecording } = await import("@/lib/voice");
    const runtime = getVoiceRuntime(body.sessionId)!;
    expect(runtime.recording).not.toBeNull();
    await finishVoiceRecording(runtime);
  });

  it("recording: no consent needed and nothing recorded when object storage is not configured", async () => {
    selectLimit.mockResolvedValueOnce([recordingAssistant()]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.recording).toBe(false);
  });

  it("recording: global no-store wins — no consent prompt, no recording", async () => {
    await withObjectStorage();
    selectLimit.mockResolvedValueOnce([
      recordingAssistant({ saveTranscripts: true }),
    ].map((row) => ({ ...row, privacySettings: { storeConversations: false } })));
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ recording: false, ephemeral: true, conversationId: null });
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("recording: owner playground also requires the disclosure", async () => {
    await withObjectStorage();
    selectLimit.mockResolvedValueOnce([recordingAssistant()]);
    const { POST } = await import("./route");
    expect((await POST(mintRequest({ source: "playground" }))).status).toBe(400);
  });

  it("mints a widget session and never leaks API keys or signing secrets", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest(
        { visitorId: "visitor01", source: "widget" },
        { Origin: "https://example.com", "User-Agent": "Mozilla/5.0" },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("voice_sess_test_1");
    expect(body.sdpAnswer).toContain("v=0");
    expect(body.ephemeral).toBe(false);
    // Durable + transcripts on: a conversation is created for voice→text continuity.
    expect(body.conversationId).toBeTruthy();
    expect(body.model).toBe("gpt-live-1");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sk-should-never-leak");
    expect(serialized).not.toContain("server-secret-only");
    expect(enforceWidgetRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ source: "widget", visitorId: "visitor01" }),
    );
    expect(insertValues).toHaveBeenCalled();
  });

  it("rejects spoofed playground source without the owner session (no security bypass)", async () => {
    getSession.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground" }));
    expect(response.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
    expect(resolveAssistantModels).not.toHaveBeenCalled();
  });

  it("rejects playground source from a non-owner session", async () => {
    getSession.mockResolvedValueOnce({ user: { id: "someone_else" } });
    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground" }));
    expect(response.status).toBe(403);
  });

  it("runs SecurityPolicy before revealing Voice config", async () => {
    selectLimit.mockResolvedValueOnce([assistantRow({ voiceSettings: { enabled: false } })]);
    enforceWidgetRequest.mockResolvedValueOnce({
      status: 403,
      message: "Origin not allowed.",
      reason: "origin_denied:evil.test",
    });
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://evil.test" }),
    );
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.error).toBe("Origin not allowed.");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects public (widget) mint when Voice is disabled", async () => {
    selectLimit.mockResolvedValueOnce([assistantRow({ voiceSettings: { enabled: false } })]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
    );
    expect(response.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("lets the verified owner prototype in the playground while Voice is not public", async () => {
    selectLimit.mockResolvedValueOnce([assistantRow({ voiceSettings: { enabled: false } })]);
    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground" }));
    expect(response.status).toBe(200);
  });

  it("API keys need the dedicated voice scope", async () => {
    usesApiKeyAuth.mockReturnValue(true);
    authorizeV1.mockResolvedValueOnce({ ok: false, status: 403, error: "Missing required scope: voice" });
    const { POST } = await import("./route");
    const response = await POST(mintRequest({}, { Authorization: "Bearer sk_live_chat_only" }));
    expect(response.status).toBe(403);
    expect(authorizeV1).toHaveBeenCalledWith(expect.any(Request), ["voice"]);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("resolves GPT-Live credentials from Voice config, not the text provider", async () => {
    const { env } = await import("@/lib/env");
    const mutableEnv = env as { VOICE_PROVIDER: string; VOICE_OPENAI_API_KEY?: string };
    mutableEnv.VOICE_PROVIDER = "gpt-live";
    try {
      // No VOICE_OPENAI_API_KEY → 503 even though the text provider is OpenAI with a key.
      const first = await (await import("./route")).POST(mintRequest({ source: "playground" }));
      expect(first.status).toBe(503);

      // Anthropic text assistant + instance voice key → mint proceeds.
      mutableEnv.VOICE_OPENAI_API_KEY = "sk-voice-instance-secret";
      selectLimit.mockResolvedValueOnce([
        assistantRow({ modelSettings: { chatProvider: "anthropic", chatModel: "claude" } }),
      ]);
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      setVoiceProviderForTests(new MockRealtimeVoiceProvider());
      const second = await (await import("./route")).POST(mintRequest({ source: "playground" }));
      expect(second.status).toBe(200);
      expect(JSON.stringify(await second.json())).not.toContain("sk-voice-instance-secret");
      expect(resolveAssistantModels).not.toHaveBeenCalled();
    } finally {
      mutableEnv.VOICE_PROVIDER = "mock";
      mutableEnv.VOICE_OPENAI_API_KEY = undefined;
    }
  });

  it("text→voice: seeds the live session with prior turns of an owned conversation", async () => {
    selectLimit
      .mockResolvedValueOnce([assistantRow()])
      .mockResolvedValueOnce([{ id: "conv_1", assistantId: "asst_internal" }]);
    historyLimit.mockResolvedValueOnce([
      { role: "assistant", content: "Pro includes 5 seats.", outcome: "answered_with_context" },
      { role: "user", content: "What is the Pro plan?", outcome: null },
    ]);
    const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
    const provider = new MockRealtimeVoiceProvider();
    const create = vi.spyOn(provider, "createWebRtcSession");
    const { setVoiceProviderForTests, getVoiceRuntime } = await import("@/lib/voice");
    setVoiceProviderForTests(provider);

    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground", conversationId: "conv_1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.conversationId).toBe("conv_1");
    expect(body.transcriptSaved).toBe(true);
    expect(create.mock.calls[0]?.[0].sessionConfig.history).toEqual([
      { role: "user", text: "What is the Pro plan?" },
      { role: "assistant", text: "Pro includes 5 seats." },
    ]);
    expect(getVoiceRuntime(body.sessionId)?.history).toEqual([
      { role: "user", content: "What is the Pro plan?" },
      { role: "assistant", content: "Pro includes 5 seats.", grounded: true },
    ]);
  });

  it("no-store playground: reads prior text turns for context without binding or writing", async () => {
    selectLimit
      .mockResolvedValueOnce([
        assistantRow({ privacySettings: { storeConversations: false } }),
      ])
      .mockResolvedValueOnce([{ id: "conv_1", assistantId: "asst_internal" }]);
    historyLimit.mockResolvedValueOnce([
      { role: "assistant", content: "Hello! How can I help?", outcome: "conversational" },
      { role: "user", content: "Hi", outcome: null },
    ]);

    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground", conversationId: "conv_1" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.conversationId).toBeNull();

    const { getVoiceRuntime } = await import("@/lib/voice");
    const runtime = getVoiceRuntime(body.sessionId);
    expect(runtime?.conversationId).toBeNull();
    expect(runtime?.history).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello! How can I help?" },
    ]);
    // Only the operational voice_sessions row.
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("uses client-held history when the server has none, never as grounded", async () => {
    selectLimit.mockResolvedValueOnce([
      assistantRow({ privacySettings: { storeConversations: false } }),
    ]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({
        source: "playground",
        history: [
          { role: "user", content: "How many members does Zenith have?" },
          { role: "assistant", content: "Zenith has 17 members." },
        ],
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    const { getVoiceRuntime } = await import("@/lib/voice");
    expect(getVoiceRuntime(body.sessionId)?.history).toEqual([
      { role: "user", content: "How many members does Zenith have?" },
      { role: "assistant", content: "Zenith has 17 members." },
    ]);
  });

  it("transcripts off: uses stored turns only, ignores client-held Voice turns, writes no messages", async () => {
    selectLimit
      .mockResolvedValueOnce([assistantRow({ voiceSettings: { enabled: true, saveTranscripts: false } })])
      .mockResolvedValueOnce([{ id: "conv_1", assistantId: "asst_internal" }]);
    historyLimit.mockResolvedValueOnce([
      { role: "assistant", content: "Pro includes 5 seats.", outcome: "answered_with_context" },
      { role: "user", content: "What is the Pro plan?", outcome: null },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({
        source: "widget",
        conversationId: "conv_1",
        history: [
          { role: "user", content: "What is the Pro plan?" },
          { role: "assistant", content: "Pro includes 5 seats." },
          { role: "user", content: "Unsaved voice question" },
          { role: "assistant", content: "Unsaved voice answer" },
        ],
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ephemeral: false, transcriptSaved: false, conversationId: "conv_1" });

    const { getVoiceRuntime } = await import("@/lib/voice");
    expect(getVoiceRuntime(body.sessionId)?.history).toEqual([
      { role: "user", content: "What is the Pro plan?" },
      { role: "assistant", content: "Pro includes 5 seats.", grounded: true },
    ]);
  });

  it("transcripts off without a stored conversation: client-held turns are ignored", async () => {
    selectLimit.mockResolvedValueOnce([
      assistantRow({ voiceSettings: { enabled: true, saveTranscripts: false } }),
    ]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({
        source: "widget",
        history: [
          { role: "user", content: "Unsaved voice question" },
          { role: "assistant", content: "Unsaved voice answer" },
        ],
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.conversationId).toBeNull();
    const { getVoiceRuntime } = await import("@/lib/voice");
    expect(getVoiceRuntime(body.sessionId)?.history).toEqual([]);
  });

  it("forwards the SDP offer byte-for-byte, including the trailing CRLF", async () => {
    selectLimit.mockResolvedValueOnce([assistantRow()]);
    const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
    const provider = new MockRealtimeVoiceProvider();
    const create = vi.spyOn(provider, "createWebRtcSession");
    const { setVoiceProviderForTests } = await import("@/lib/voice");
    setVoiceProviderForTests(provider);

    const sdpOffer = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=max-message-size:262144\r\n";
    const { POST } = await import("./route");
    const response = await POST(mintRequest({ source: "playground", sdpOffer }));
    expect(response.status).toBe(200);
    expect(create.mock.calls[0]?.[0].sdpOffer).toBe(sdpOffer);
  });

  it("rejects a blank SDP offer", async () => {
    const { POST } = await import("./route");
    const response = await POST(mintRequest({ sdpOffer: " \r\n " }));
    expect(response.status).toBe(400);
  });

  it("rejects binding to a conversation owned by another assistant", async () => {
    selectLimit
      .mockResolvedValueOnce([assistantRow()])
      .mockResolvedValueOnce([{ id: "conv_other", assistantId: "asst_other" }]);
    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ source: "playground", conversationId: "conv_other" }),
    );
    expect(response.status).toBe(404);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("no-store: ephemeral session, saves forced off, no conversational rows", async () => {
    selectLimit
      .mockResolvedValueOnce([
        assistantRow({
          privacySettings: { storeConversations: false },
          voiceSettings: { enabled: true, saveTranscripts: true, saveAudioRecordings: true },
        }),
      ])
      .mockResolvedValueOnce([]);

    const { POST } = await import("./route");
    const response = await POST(
      mintRequest({ source: "playground", conversationId: "conv_should_be_ignored" }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ephemeral).toBe(true);

    const { getVoiceRuntime } = await import("@/lib/voice");
    const runtime = getVoiceRuntime(body.sessionId);
    expect(runtime?.ephemeral).toBe(true);
    expect(runtime?.conversationId).toBeNull();
    expect(runtime?.persistence.saveTranscripts).toBe(false);
    expect(runtime?.persistence.saveAudioRecordings).toBe(false);

    // Exactly one insert: the operational voice_sessions row. No voice_events / messages.
    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls.at(0)?.at(0) as Record<string, unknown> | undefined;
    expect(row?.ephemeral).toBe(true);
    expect(row?.conversationId).toBeNull();
    const keys = Object.keys(row ?? {});
    for (const forbidden of ["content", "transcript", "payload", "storageKey"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  describe("Voice usage admission", () => {
    it("widget refusal (minutes exhausted) is neutral and never creates a provider session", async () => {
      admitVoiceSession.mockResolvedValueOnce({
        ok: false,
        status: 402,
        reason: "voice_minutes_exhausted",
      });
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const provider = new MockRealtimeVoiceProvider();
      const create = vi.spyOn(provider, "createWebRtcSession");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      setVoiceProviderForTests(provider);

      const { POST } = await import("./route");
      const response = await POST(
        mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
      );
      // Neutral on the wire too: no 402 and no minutes/quota reason for visitors.
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string; reason: string };
      expect(body).toEqual({ error: "Voice isn't available right now.", reason: "voice_unavailable" });
      expect(JSON.stringify(body)).not.toMatch(/minute|plan|limit|quota|exhausted|concurrency|billing/i);
      expect(create).not.toHaveBeenCalled();
    });

    it("widget concurrency refusal is the same neutral response", async () => {
      admitVoiceSession.mockResolvedValueOnce({
        ok: false,
        status: 429,
        reason: "voice_concurrency_limit",
      });
      const { POST } = await import("./route");
      const response = await POST(
        mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Voice isn't available right now.",
        reason: "voice_unavailable",
      });
    });

    it("playground refusal tells the owner the cause", async () => {
      admitVoiceSession.mockResolvedValueOnce({
        ok: false,
        status: 429,
        reason: "voice_concurrency_limit",
      });
      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground" }));
      expect(response.status).toBe(429);
      const body = (await response.json()) as { error: string; reason: string };
      expect(body.reason).toBe("voice_concurrency_limit");
      expect(body.error).toMatch(/too many voice sessions/i);
    });

    it("admits with the session id, source and persistence before provider create", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
      );
      expect(response.status).toBe(200);
      expect(admitVoiceSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "voice_sess_test_1",
          assistantId: "asst_internal",
          source: "widget",
          visitorId: "visitor01",
          ephemeral: false,
        }),
      );
      const { getVoiceRuntime, terminateVoiceSession } = await import("@/lib/voice");
      const runtime = getVoiceRuntime("voice_sess_test_1")!;
      expect(runtime.metering).toMatchObject({ mode: "enforce", quotaExempt: false });
      await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
      expect(settleVoiceUsage).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "voice_sess_test_1", measurement: "provider_final" }),
      );
    });

    it("provider create failure returns the grant instead of settling", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      setVoiceProviderForTests(new MockRealtimeVoiceProvider({ failCreateWith: "boom" }));
      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground" }));
      expect(response.status).toBe(502);
      expect(releaseVoiceAdmission).toHaveBeenCalledWith("voice_sess_test_1");
      expect(settleVoiceUsage).not.toHaveBeenCalled();
    });

    it("failure after provider create settles not-billable (0 Voice seconds)", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      setVoiceProviderForTests(new MockRealtimeVoiceProvider({ failAttachWith: "attach failed" }));
      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground" }));
      expect(response.status).toBe(502);
      expect(releaseVoiceAdmission).not.toHaveBeenCalled();
      expect(settleVoiceUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "voice_sess_test_1",
          measurement: "none",
          providerSeconds: 0,
          finalizeRow: { status: "failed", errorCode: "mint_failed" },
        }),
      );
    });
  });

  describe("browser command lock", () => {
    it("fails closed when the provider does not confirm the lock: hangup, neutral 502, no session row", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests, getVoiceRuntime } = await import("@/lib/voice");
      const provider = new MockRealtimeVoiceProvider({ browserCommandsUnlocked: true });
      setVoiceProviderForTests(provider);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const { POST } = await import("./route");
        const response = await POST(mintRequest({ source: "playground" }));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({
          error: "Voice isn't available right now.",
          reason: "voice_unavailable",
        });
        expect(provider.hangups).toEqual(["mock_sess_1"]);
        expect(getVoiceRuntime("voice_sess_test_1")).toBeUndefined();
        const rows = insertValues.mock.calls.map((call) => (call as unknown[])[0] as Record<string, unknown>);
        expect(rows.some((row) => row.providerSessionId !== undefined)).toBe(false);
        expect(settleVoiceUsage).toHaveBeenCalledWith(
          expect.objectContaining({ measurement: "none", providerSeconds: 0 }),
        );
        const logged = warn.mock.calls.find((call) => call[0] === "[voice] mint.failed");
        expect(logged?.[1]).toMatchObject({
          code: "browser_command_lock_unconfirmed",
          providerSessionCreated: true,
        });
      } finally {
        warn.mockRestore();
      }
    });

    it("confirms the lock when session.started arrives right after attach while a new conversation is created", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests, getVoiceRuntime } = await import("@/lib/voice");
      setVoiceProviderForTests(new MockRealtimeVoiceProvider({ startedAfterAttach: true }));
      // A slow conversation insert (remote database) must not swallow session.started.
      insertValues.mockImplementation((row?: unknown) =>
        Object.keys((row ?? {}) as object).sort().join() === "assistantId,id,source,visitorId"
          ? insertResult(new Promise((resolve) => setTimeout(() => resolve(undefined), 20)))
          : insertResult(),
      );
      try {
        const { POST } = await import("./route");
        const response = await POST(mintRequest({ source: "playground" }));
        expect(response.status).toBe(200);
        expect(getVoiceRuntime("voice_sess_test_1")?.browserCommandsBlocked).toBe(true);
      } finally {
        insertValues.mockImplementation(() => insertResult());
      }
    });

    it("a provider that rejects the lock field is a neutral failure too, and nothing leaks", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      const provider = new MockRealtimeVoiceProvider({
        failCreateWith:
          "GPT-Live session create failed (400): Unknown parameter: 'session.client.data_channel.allowed_client_events'",
      });
      setVoiceProviderForTests(provider);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const { POST } = await import("./route");
        const response = await POST(mintRequest({ source: "playground" }));
        expect(response.status).toBe(502);
        const text = await response.text();
        expect(text).not.toMatch(/allowed_client_events|GPT-Live|400/);
        expect(provider.hangups).toEqual([]);
        const logged = warn.mock.calls.find((call) => call[0] === "[voice] mint.failed");
        expect(logged?.[1]).toMatchObject({
          code: "browser_command_lock_rejected",
          providerStatus: 400,
          providerSessionCreated: false,
        });
        expect(JSON.stringify(logged)).not.toContain("allowed_client_events");
      } finally {
        warn.mockRestore();
      }
    });

    it("widget visitors never see provider details for any mint failure", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { setVoiceProviderForTests } = await import("@/lib/voice");
      setVoiceProviderForTests(new MockRealtimeVoiceProvider({ failAttachWith: "attach failed: upstream 503" }));
      const { POST } = await import("./route");
      const response = await POST(
        mintRequest({ visitorId: "visitor01", source: "widget" }, { Origin: "https://example.com" }),
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Voice isn't available right now.",
        reason: "voice_unavailable",
      });
    });
  });

  describe("control heartbeat capability", () => {
    it("a client that declares heartbeats gets a session-bound control token", async () => {
      const { POST } = await import("./route");
      const response = await POST(
        mintRequest(
          { visitorId: "visitor01", source: "widget", capabilities: ["heartbeat"] },
          { Origin: "https://example.com" },
        ),
      );
      const body = (await response.json()) as { sessionId: string; controlToken: string; heartbeatIntervalMs: number };
      expect(response.status).toBe(200);
      expect(body.heartbeatIntervalMs).toBe(5_000);
      const { verifyVoiceControlToken, getVoiceRuntime } = await import("@/lib/voice");
      expect(verifyVoiceControlToken(body.controlToken, body.sessionId)).toEqual({ ok: true, visitorId: "visitor01" });
      expect(verifyVoiceControlToken(body.controlToken, "voice_sess_other")).toEqual({ ok: false });
      expect(getVoiceRuntime(body.sessionId)!.supervision?.heartbeatCapable).toBe(true);
      expect(JSON.stringify(body)).not.toContain("test-auth-secret-not-real");
    });

    it("clients without the capability get no token and are never ended for missing heartbeats", async () => {
      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground" }));
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.controlToken).toBeUndefined();
      expect(body.heartbeatIntervalMs).toBeUndefined();
      const { getVoiceRuntime } = await import("@/lib/voice");
      expect(getVoiceRuntime(String(body.sessionId))!.supervision?.heartbeatCapable).toBe(false);
    });

    it("rejects unknown capabilities", async () => {
      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground", capabilities: ["provider_events"] }));
      expect(response.status).toBe(400);
    });
  });

  describe("graceful shutdown and runtime mode", () => {
    const NEUTRAL = { error: "Voice isn't available right now.", reason: "voice_unavailable" };

    it("while draining, new mints are refused neutrally before any admission or provider work", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { drainVoiceRuntime, setVoiceProviderForTests } = await import("@/lib/voice");
      const provider = new MockRealtimeVoiceProvider();
      const create = vi.spyOn(provider, "createWebRtcSession");
      setVoiceProviderForTests(provider);
      await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

      const { POST } = await import("./route");
      for (const source of ["widget", "playground"] as const) {
        const response = await POST(mintRequest({ visitorId: "visitor01", source }, { Origin: "https://example.com" }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(NEUTRAL);
      }
      expect(admitVoiceSession).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("a mint racing the drain start: provider session hung up, admission settled, 503, never registered", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { drainVoiceRuntime, listVoiceRuntimes, setVoiceProviderForTests } = await import("@/lib/voice");
      const provider = new MockRealtimeVoiceProvider();
      const create = provider.createWebRtcSession.bind(provider);
      let drain: ReturnType<typeof drainVoiceRuntime> | null = null;
      vi.spyOn(provider, "createWebRtcSession").mockImplementation(async (input) => {
        const created = await create(input);
        drain = drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });
        return created;
      });
      setVoiceProviderForTests(provider);

      const { POST } = await import("./route");
      const response = await POST(
        mintRequest({ visitorId: "visitor01", source: "widget", capabilities: ["heartbeat"] }, { Origin: "https://example.com" }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual(NEUTRAL);
      expect(provider.hangups).toEqual(["mock_sess_1"]);
      expect(listVoiceRuntimes()).toHaveLength(0);
      expect(settleVoiceUsage).toHaveBeenCalledTimes(1);
      expect(settleVoiceUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          measurement: "none",
          providerSeconds: 0,
          finalizeRow: { status: "failed", errorCode: "shutdown" },
        }),
      );
      // The drain waited for the refused mint's cleanup.
      const report = await drain!;
      expect(report).toMatchObject({ live: 0, mintsInFlight: 1, timedOut: 0 });
    });

    it("a drain that starts during admission stops the mint before any provider session exists", async () => {
      const { MockRealtimeVoiceProvider } = await import("@chatai/voice/mock");
      const { drainVoiceRuntime, setVoiceProviderForTests } = await import("@/lib/voice");
      const provider = new MockRealtimeVoiceProvider();
      const create = vi.spyOn(provider, "createWebRtcSession");
      setVoiceProviderForTests(provider);
      admitVoiceSession.mockImplementationOnce(async () => {
        void drainVoiceRuntime({ trigger: "SIGINT", graceMs: 8_000 });
        return admissionOk();
      });

      const { POST } = await import("./route");
      const response = await POST(mintRequest({ source: "playground" }));

      expect(response.status).toBe(503);
      expect(create).not.toHaveBeenCalled();
      expect(releaseVoiceAdmission).toHaveBeenCalledWith("voice_sess_test_1");
      expect(settleVoiceUsage).not.toHaveBeenCalled();
    });

    it("serverless platforms fail closed: neutral 503, operator log, no Voice work", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      process.env.AWS_LAMBDA_FUNCTION_NAME = "chatai-web";
      try {
        const { POST } = await import("./route");
        const response = await POST(mintRequest({ source: "playground" }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual(NEUTRAL);
        expect(admitVoiceSession).not.toHaveBeenCalled();
        const logged = warn.mock.calls.find((call) => call[0] === "[voice] mint.refused");
        expect(logged?.[1]).toMatchObject({ code: "serverless_unsupported", platform: "aws_lambda" });
      } finally {
        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        warn.mockRestore();
      }
    });
  });
});
