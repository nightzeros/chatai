import { assistants, conversations, messages } from "@chatai/database";
import type { PreparedAnswer } from "@chatai/rag/answer";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

let assistantRow: Row;
/** Stored history rows, newest first (the shared loader reverses them). */
let historyRows: Row[] = [];
const inserted: Array<{ table: unknown; row: Row }> = [];

vi.mock("@/lib/db", () => ({
  db: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () =>
            table === assistants
              ? [assistantRow]
              : table === conversations
                ? [{ id: "conv_1", assistantId: "asst_internal" }]
                : [],
          orderBy: () => ({ limit: async () => (table === messages ? historyRows : []) }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: Row) => {
        inserted.push({ table, row });
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
}));
const envMock: Record<string, unknown> = {};
vi.mock("@/lib/env", () => ({ env: envMock }));
let apiKeyRequest = false;
vi.mock("@/lib/api-keys", () => ({ usesApiKeyAuth: () => apiKeyRequest }));
vi.mock("@/lib/authorize-v1", () => ({
  authorizeV1: async () => ({ ok: true, userId: "user_1", apiKeyId: "key_1" }),
}));
vi.mock("@/lib/assistants", () => ({ getOwnedAssistantByRef: async () => assistantRow }));
vi.mock("@/lib/eval-worker", () => ({ startEvalWorker: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ consumeApiKeyRateLimit: async () => ({ ok: true }) }));
/** Dashboard session user (null: anonymous). The assistant owner is user_1. */
let sessionUserId: string | null = "user_1";
vi.mock("@/lib/session", () => ({
  getSession: async () => (sessionUserId ? { user: { id: sessionUserId } } : null),
}));
const resolveBillableAccountForAssistant = vi.fn();
const checkHostingAccountAccess = vi.fn();
vi.mock("@/lib/hosting/accounts", () => ({
  resolveBillableAccountForAssistant: (...args: unknown[]) => resolveBillableAccountForAssistant(...args),
  checkHostingAccountAccess: (...args: unknown[]) => checkHostingAccountAccess(...args),
}));
const beginChatUsageReservation = vi.fn();
const finishChatUsageReservation = vi.fn();
const abortChatUsageReservation = vi.fn();
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: (...args: unknown[]) => beginChatUsageReservation(...args),
  finishChatUsageReservation: (...args: unknown[]) => finishChatUsageReservation(...args),
  abortChatUsageReservation: (...args: unknown[]) => abortChatUsageReservation(...args),
}));
const enforceWidgetRequest = vi.fn();
vi.mock("@/lib/policies/security-policy", () => ({
  SecurityPolicy: { fromAssistant: () => ({ enforceWidgetRequest }) },
}));
let modelBilling: Record<string, string> = {};
vi.mock("@/lib/ai-config", () => ({
  resolveAssistantModels: async () => ({
    chat: { provider: "openai", model: "gpt", apiKey: "k", baseURL: "" },
    embedding: { provider: "openai", model: "e", apiKey: "k", baseURL: "", dimensions: 3 },
    billing: modelBilling,
  }),
}));
let idSeq = 0;
vi.mock("@/lib/ids", () => ({ createId: () => `id_${++idSeq}` }));
vi.mock("@chatai/evals", () => ({
  enqueueOnlineEvalJob: vi.fn(),
  shouldSampleEval: () => false,
}));

const streamChat = vi.fn();
const generateChat = vi.fn();
vi.mock("@chatai/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chatai/ai")>()),
  streamChat: (...args: unknown[]) => streamChat(...args),
  generateChat: (...args: unknown[]) => generateChat(...args),
}));

const prepareAnswer = vi.fn();
vi.mock("@chatai/rag/answer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chatai/rag/answer")>()),
  prepareAnswer: (...args: unknown[]) => prepareAnswer(...args),
}));

function prepared(overrides: Partial<PreparedAnswer>): PreparedAnswer {
  return {
    query: "q",
    retrieved: [],
    decision: { action: "generate", contextSufficient: true, confidence: "high", bestScore: 0, mode: "balanced" },
    outcome: "answered_with_context",
    confidence: 0,
    system: "SYSTEM",
    shouldGenerate: true,
    fallbackText: "I don't know.",
    messages: [],
    turn: { kind: "knowledge", retrieval: "performed" },
    debug: {},
    providerUsages: [],
    ...overrides,
  };
}

async function post(body: Row) {
  const { POST } = await import("./route");
  const response = await POST(
    new Request("http://localhost:3000/api/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistantId: "asst_public", ...body }),
    }),
  );
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return { status: response.status, json: (await response.json()) as Row, text: "", meta: undefined };
  }
  const events = (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice(5)) as Row);
  return {
    status: response.status,
    json: undefined as Row | undefined,
    text: events.filter((event) => event.type === "token").map((event) => event.text).join(""),
    meta: events.find((event) => event.type === "meta"),
  };
}

function messageRows() {
  return inserted.filter((entry) => entry.table === messages).map((entry) => entry.row);
}

describe("POST /api/v1/chat conversation history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserted.length = 0;
    historyRows = [];
    idSeq = 0;
    apiKeyRequest = false;
    sessionUserId = "user_1";
    resolveBillableAccountForAssistant.mockImplementation(async () => ({ id: "acct_1", status: "active" }));
    checkHostingAccountAccess.mockImplementation(() => ({ ok: true }));
    beginChatUsageReservation.mockImplementation(async () => ({ ok: true, reservation: null }));
    finishChatUsageReservation.mockImplementation(async () => undefined);
    abortChatUsageReservation.mockImplementation(async () => undefined);
    enforceWidgetRequest.mockImplementation(async () => null);
    delete envMock.OUTPUT_SCOPE_CHECK;
    assistantRow = {
      id: "asst_internal",
      publicId: "asst_public",
      userId: "user_1",
      name: "Zenith",
      instructions: null,
      hallucinationMode: "balanced",
      ragSettings: { guardrails: { verifyCitations: false } },
      privacySettings: { storeConversations: true },
      securitySettings: {},
      modelSettings: {},
    };
  });

  it("persists and returns a greeting that needed no retrieval", async () => {
    prepareAnswer.mockResolvedValueOnce(
      prepared({
        outcome: "conversational",
        shouldGenerate: false,
        fallbackText: "Hello! How can I help you today?",
        turn: { kind: "conversational", retrieval: "skipped" },
      }),
    );
    const result = await post({ message: "Hi", source: "playground" });

    expect(result.status).toBe(200);
    expect(result.text).toBe("Hello! How can I help you today?");
    expect(result.meta).toMatchObject({ outcome: "conversational", sources: [] });
    expect(streamChat).not.toHaveBeenCalled();
    expect(messageRows().map((row) => [row.role, row.content, row.outcome])).toEqual([
      ["user", "Hi", undefined],
      ["assistant", "Hello! How can I help you today?", "conversational"],
    ]);
  });

  it("loads stored history (voice rows included) and generates with prepared.messages", async () => {
    historyRows = [
      { role: "assistant", content: "Zenith has 17 members.", outcome: "answered_with_context" },
      { role: "user", content: "How many members does Zenith have?", outcome: null },
      { role: "assistant", content: "Hello!", outcome: "conversational" },
      { role: "user", content: "Hi", outcome: null },
    ];
    const generationMessages = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello!" },
      { role: "user" as const, content: "How many members does Zenith have?" },
      { role: "assistant" as const, content: "Zenith has 17 members." },
      { role: "user" as const, content: "When was it founded?" },
    ];
    prepareAnswer.mockResolvedValueOnce(prepared({ messages: generationMessages }));
    streamChat.mockReturnValueOnce({
      textStream: (async function* () {
        yield "Zenith was founded in 2011.";
      })(),
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    });

    const result = await post({
      message: "When was it founded?",
      conversationId: "conv_1",
      source: "playground",
    });

    expect(prepareAnswer.mock.calls[0]?.[0].history).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How many members does Zenith have?" },
      { role: "assistant", content: "Zenith has 17 members.", grounded: true },
    ]);
    expect(streamChat.mock.calls[0]?.[0]).toMatchObject({ messages: generationMessages });
    expect(streamChat.mock.calls[0]?.[0]).not.toHaveProperty("maxOutputTokens");
    expect(result.text).toBe("Zenith was founded in 2011.");
  });

  it("caps hosted answer output at the reserved output tokens", async () => {
    modelBilling = { chat: "hosted", embedding: "hosted", rerank: "hosted" };
    envMock.HOSTED_USAGE_MAX_OUTPUT_TOKENS = 1024;
    try {
      prepareAnswer.mockResolvedValueOnce(prepared({}));
      streamChat.mockReturnValueOnce({
        textStream: (async function* () {
          yield "Open 8 to 6.";
        })(),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      });
      await post({ message: "When are you open?", source: "playground" });
      expect(streamChat.mock.calls[0]?.[0]).toMatchObject({ maxOutputTokens: 1024 });
    } finally {
      modelBilling = {};
      delete envMock.HOSTED_USAGE_MAX_OUTPUT_TOKENS;
    }
  });

  it("persists both turns even when retrieval fails", async () => {
    prepareAnswer.mockResolvedValueOnce(
      prepared({ outcome: "retrieval_failure", shouldGenerate: false, fallbackText: "I don't know." }),
    );
    await post({ message: "What is the refund policy?", source: "playground" });
    expect(messageRows().map((row) => row.role)).toEqual(["user", "assistant"]);
    expect(messageRows()[1]).toMatchObject({ outcome: "retrieval_failure" });
  });

  it("stored conversation: ignores client-held turns such as unsaved Voice", async () => {
    historyRows = [
      { role: "assistant", content: "Zenith has 17 members.", outcome: "answered_with_context" },
      { role: "user", content: "How many members does Zenith have?", outcome: null },
    ];
    prepareAnswer.mockResolvedValueOnce(
      prepared({ outcome: "conversational", shouldGenerate: false, fallbackText: "You're welcome!" }),
    );
    await post({
      message: "Thanks",
      conversationId: "conv_1",
      source: "playground",
      history: [
        { role: "user", content: "How many members does Zenith have?" },
        { role: "assistant", content: "Zenith has 17 members." },
        { role: "user", content: "Is it hiring?" },
        { role: "assistant", content: "Yes, Zenith is hiring engineers." },
      ],
    });
    expect(prepareAnswer.mock.calls[0]?.[0].history).toEqual([
      { role: "user", content: "How many members does Zenith have?" },
      { role: "assistant", content: "Zenith has 17 members.", grounded: true },
    ]);
  });

  it("no-store: uses client history for context and writes nothing", async () => {
    assistantRow.privacySettings = { storeConversations: false };
    prepareAnswer.mockResolvedValueOnce(
      prepared({ outcome: "conversational", shouldGenerate: false, fallbackText: "You're welcome!" }),
    );
    const result = await post({
      message: "Thanks",
      source: "widget",
      visitorId: "visitor01",
      history: [
        { role: "user", content: "How many members does Zenith have?" },
        { role: "assistant", content: "Zenith has 17 members." },
      ],
    });

    expect(result.status).toBe(200);
    expect(prepareAnswer.mock.calls[0]?.[0].history).toEqual([
      { role: "user", content: "How many members does Zenith have?" },
      { role: "assistant", content: "Zenith has 17 members.", clientSupplied: true },
    ]);
    expect(inserted).toEqual([]);
  });

  it("rejects unbounded client history", async () => {
    const history = Array.from({ length: 41 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x",
    }));
    const result = await post({ message: "Hi", source: "widget", history });
    expect(result.status).toBe(400);
    expect(prepareAnswer).not.toHaveBeenCalled();
  });

  it("passes the neutral voiceUnavailable flag through, and nothing is stored for it", async () => {
    prepareAnswer.mockResolvedValueOnce(
      prepared({
        outcome: "conversational",
        shouldGenerate: false,
        fallbackText: "Voice became unavailable, so we switched back to text. We can continue here.",
      }),
    );
    const result = await post({
      message: "Why did the voice end?",
      source: "widget",
      visitorId: "visitor01",
      voiceUnavailable: true,
    });

    expect(result.status).toBe(200);
    expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({ voiceUnavailable: true });
    // Only the visible turns are stored: no system note or Voice reason in the transcript.
    expect(messageRows().map((row) => [row.role, row.content])).toEqual([
      ["user", "Why did the voice end?"],
      ["assistant", "Voice became unavailable, so we switched back to text. We can continue here."],
    ]);
    expect(JSON.stringify(inserted.map((entry) => entry.row))).not.toMatch(/usage_limit|quota|voice_unavailable|voiceUnavailable/i);
  });

  describe("scope redirects", () => {
    const scope = { decision: "out" as const, redirectSource: "template" as const, plannerMs: 210, plannerWaitMs: 0 };
    const redirect = "I can help with questions about Zenith. Is there something I can help you with?";
    const outOfScope = () =>
      prepared({
        outcome: "out_of_scope",
        shouldGenerate: false,
        fallbackText: redirect,
        turn: { kind: "knowledge", retrieval: "skipped" },
        debug: { scope },
        scope,
      });

    it("passes the assistant name to the shared scope policy", async () => {
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      await post({ message: "What's the best laptop?", source: "widget", visitorId: "visitor01" });
      expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({ assistantName: "Zenith", instructions: null });
    });

    it("widget: persists out_of_scope for the owner; the visitor sees only a conversational reply", async () => {
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      const result = await post({ message: "What's the best laptop?", source: "widget", visitorId: "visitor01" });

      expect(result.text).toBe(redirect);
      expect(streamChat).not.toHaveBeenCalled();
      expect(messageRows()[1]).toMatchObject({ outcome: "out_of_scope", debug: { scope } });
      expect(result.meta).toMatchObject({ outcome: "conversational" });
      expect(JSON.stringify(result.meta)).not.toMatch(/out_of_scope|scope|debug/);
    });

    it("api: same visitor-safe outcome", async () => {
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      const result = await post({ message: "What's the best laptop?", source: "api" });
      expect(result.meta?.outcome).toBe("conversational");
    });

    it("playground (owner): keeps out_of_scope and the scope debug", async () => {
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      const result = await post({ message: "What's the best laptop?", source: "playground" });
      expect(result.meta).toMatchObject({ outcome: "out_of_scope", debug: { scope } });
    });
  });

  it("ordinary chats do not carry the Voice flag", async () => {
    prepareAnswer.mockResolvedValueOnce(
      prepared({ outcome: "conversational", shouldGenerate: false, fallbackText: "Hello!" }),
    );
    await post({ message: "Hi", source: "widget", visitorId: "visitor01" });
    expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({ voiceUnavailable: false });
  });

  describe("output scope check", () => {
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const redirect = "I can help with questions about Zenith. What would you like to know?";
    const plan = (reasons: string[]) => ({
      reasons,
      purposeBlock: "# Purpose\nZenith membership questions.",
      request: "Tell me about Zenith",
      decision: "in" as const,
      injectionSuspected: false,
      redirect,
    });

    it("a gated answer is buffered, checked, and replaced when it drifts off-purpose", async () => {
      envMock.OUTPUT_SCOPE_CHECK = true;
      prepareAnswer.mockResolvedValueOnce(prepared({ guard: plan(["flexible"]) as PreparedAnswer["guard"] }));
      generateChat
        .mockResolvedValueOnce({ text: "Here is a lasagna recipe.", usage })
        .mockResolvedValueOnce({ text: '{"onPurpose":false}', usage });

      const result = await post({ message: "Tell me about Zenith", source: "playground" });
      expect(streamChat).not.toHaveBeenCalled();
      expect(result.text).toBe(redirect);
      expect(result.meta).toMatchObject({ outcome: "out_of_scope" });
      expect(messageRows()[1]).toMatchObject({ content: redirect, outcome: "out_of_scope" });
      expect(JSON.stringify(inserted.map((entry) => entry.row))).not.toMatch(/lasagna/);
    });

    it("an ungated answer streams without a check", async () => {
      envMock.OUTPUT_SCOPE_CHECK = true;
      prepareAnswer.mockResolvedValueOnce(prepared({ guard: plan([]) as PreparedAnswer["guard"] }));
      streamChat.mockReturnValueOnce({
        textStream: (async function* () {
          yield "Zenith has 17 members [1].";
        })(),
        usage: Promise.resolve(usage),
      });
      const result = await post({ message: "How many members?", source: "playground" });
      expect(generateChat).not.toHaveBeenCalled();
      expect(result.text).toBe("Zenith has 17 members [1].");
    });

    it("the partial sentence is appended server-side as the final streamed token", async () => {
      prepareAnswer.mockResolvedValueOnce(
        prepared({ answerRequest: "Zenith members", answerSuffix: "The other part of your question isn't something I can help with here." }),
      );
      streamChat.mockReturnValueOnce({
        textStream: (async function* () {
          yield "Zenith has 17 members [1].";
        })(),
        usage: Promise.resolve(usage),
      });
      const result = await post({ message: "How many members, and who won the match?", source: "playground" });
      expect(result.text).toBe(
        "Zenith has 17 members [1]. The other part of your question isn't something I can help with here.",
      );
    });
  });

  describe("playground source is verified, never trusted", () => {
    const scope = { decision: "out" as const, redirectSource: "template" as const };
    const outOfScope = () =>
      prepared({
        outcome: "out_of_scope",
        shouldGenerate: false,
        fallbackText: "I can help with Zenith.",
        debug: { scope },
        scope,
      });
    const conversationRows = () => inserted.filter((entry) => entry.table === conversations).map((entry) => entry.row);

    for (const [label, user] of [
      ["anonymous", null],
      ["an authenticated non-owner", "user_2"],
    ] as const) {
      it(`${label} claiming playground is treated as a widget visitor`, async () => {
        sessionUserId = user;
        assistantRow.privacySettings = { storeConversations: false };
        prepareAnswer.mockResolvedValueOnce(outOfScope());

        const result = await post({ message: "Best laptop?", source: "playground", visitorId: "visitor01" });

        // Widget SecurityPolicy (domain, rate limits, bot checks, HMAC) runs as for any visitor.
        expect(enforceWidgetRequest).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ source: "widget" }));
        // No usage exemption: the gate sees a widget request.
        expect(beginChatUsageReservation.mock.calls[0]?.[0]).toMatchObject({ source: "widget" });
        // No-store is respected.
        expect(inserted).toEqual([]);
        // No owner outcome or debug metadata.
        expect(result.meta).toMatchObject({ outcome: "conversational" });
        expect(JSON.stringify(result.meta)).not.toMatch(/out_of_scope|debug|scope/);
      });
    }

    it("a spoofed playground source is blocked by the widget SecurityPolicy", async () => {
      sessionUserId = null;
      enforceWidgetRequest.mockResolvedValueOnce({ status: 403, message: "Origin not allowed.", reason: "origin_denied:evil.example" });
      const result = await post({ message: "Hi", source: "playground", visitorId: "visitor01" });
      expect(result.status).toBe(403);
      expect(prepareAnswer).not.toHaveBeenCalled();
      expect(beginChatUsageReservation).not.toHaveBeenCalled();
    });

    it("a stored spoofed conversation is recorded as widget, not playground", async () => {
      sessionUserId = null;
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      await post({ message: "Best laptop?", source: "playground", visitorId: "visitor01" });
      expect(conversationRows()).toEqual([expect.objectContaining({ source: "widget" })]);
    });

    it("the verified owner keeps Playground behavior", async () => {
      assistantRow.privacySettings = { storeConversations: false };
      prepareAnswer.mockResolvedValueOnce(outOfScope());

      const result = await post({ message: "Best laptop?", source: "playground" });

      expect(enforceWidgetRequest).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({ source: "playground" }));
      expect(beginChatUsageReservation.mock.calls[0]?.[0]).toMatchObject({ source: "playground" });
      // The owner Playground always persists, even with conversation storage off.
      expect(conversationRows()).toEqual([expect.objectContaining({ source: "playground" })]);
      expect(result.meta).toMatchObject({ outcome: "out_of_scope", debug: { scope } });
    });

    it("an API key claiming playground is an API request", async () => {
      apiKeyRequest = true;
      prepareAnswer.mockResolvedValueOnce(outOfScope());
      const result = await post({ message: "Best laptop?", source: "playground" });
      expect(enforceWidgetRequest).not.toHaveBeenCalled();
      expect(beginChatUsageReservation.mock.calls[0]?.[0]).toMatchObject({ source: "api" });
      expect(result.meta).toMatchObject({ outcome: "conversational" });
      expect(result.meta).not.toHaveProperty("debug");
    });
  });

  describe("visitors never see account or plan details", () => {
    const planDetails = /plan|allowance|upgrade|quota|billing|usage|suspended|disabled|account|reason/i;
    const limit = {
      ok: false,
      status: 402,
      error: "You've reached your monthly hosted AI allowance. Upgrade your plan or wait until your usage period resets.",
      reason: "usage_limit_exceeded",
    };
    const suspended = {
      ok: false,
      status: 403,
      error: "Hosted AI is temporarily unavailable for this account.",
      reason: "account_suspended",
    };

    it("usage limit: a widget visitor gets a generic refusal", async () => {
      beginChatUsageReservation.mockResolvedValueOnce(limit);
      const result = await post({ message: "Hi", source: "widget", visitorId: "visitor01" });
      expect(result.status).toBe(403);
      expect(result.json).toEqual({ error: "This assistant isn't available right now. Please try again later." });
      expect(JSON.stringify(result.json)).not.toMatch(planDetails);
    });

    it("usage limit: a spoofed playground visitor gets the same generic refusal", async () => {
      sessionUserId = null;
      beginChatUsageReservation.mockResolvedValueOnce(limit);
      const result = await post({ message: "Hi", source: "playground", visitorId: "visitor01" });
      expect(JSON.stringify(result.json)).not.toMatch(planDetails);
    });

    it("usage limit: the verified owner and API keys keep the detail", async () => {
      beginChatUsageReservation.mockResolvedValueOnce(limit);
      const owner = await post({ message: "Hi", source: "playground" });
      expect(owner).toMatchObject({ status: 402, json: { error: limit.error, reason: "usage_limit_exceeded" } });

      apiKeyRequest = true;
      beginChatUsageReservation.mockResolvedValueOnce(limit);
      const integration = await post({ message: "Hi" });
      expect(integration).toMatchObject({ status: 402, json: { reason: "usage_limit_exceeded" } });
    });

    it("account state: a visitor gets a generic refusal, the owner the detail", async () => {
      checkHostingAccountAccess.mockReturnValue(suspended);
      const visitor = await post({ message: "Hi", source: "widget", visitorId: "visitor01" });
      expect(visitor.status).toBe(403);
      expect(JSON.stringify(visitor.json)).not.toMatch(planDetails);

      const owner = await post({ message: "Hi", source: "playground" });
      expect(owner.json).toEqual({ error: suspended.error });
    });

    it("the SecurityPolicy runs before any account state is consulted", async () => {
      checkHostingAccountAccess.mockReturnValue(suspended);
      enforceWidgetRequest.mockResolvedValueOnce({ status: 403, message: "Origin not allowed.", reason: "origin_denied:evil.example" });
      const result = await post({ message: "Hi", source: "widget", visitorId: "visitor01" });
      expect(result.status).toBe(403);
      expect(JSON.stringify(result.json)).not.toMatch(/Hosted AI|account/i);
      expect(resolveBillableAccountForAssistant).not.toHaveBeenCalled();
    });
  });

  describe("usage already incurred survives failures", () => {
    const usage = { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, totalTokens: 12 };
    const routerRecord = { kind: "chat_completion" as const, provider: "openai", model: "gpt", usage, step: "rewrite_query" };
    const reservation = { reservationEventId: "evt_1", accountId: "acct_1" };
    /** prepareAnswer that reports its router usage as it completes, like the real one. */
    const preparedWithUsage = (overrides: Partial<PreparedAnswer> = {}) =>
      async (args: { onUsage?: (record: typeof routerRecord) => void }) => {
        args.onUsage?.(routerRecord);
        return prepared({ providerUsages: [routerRecord], ...overrides });
      };

    beforeEach(() => {
      beginChatUsageReservation.mockImplementation(async () => ({ ok: true, reservation }));
    });

    it("preparation throws after the router ran: the router usage is charged as a failed request", async () => {
      prepareAnswer.mockImplementationOnce(async (args: { onUsage?: (record: typeof routerRecord) => void }) => {
        args.onUsage?.(routerRecord);
        throw new Error("planner exploded");
      });
      const result = await post({ message: "Tell me about Zenith", source: "widget", visitorId: "visitor01" });

      expect(result.meta).toMatchObject({ outcome: "model_failure" });
      expect(abortChatUsageReservation).not.toHaveBeenCalled();
      expect(finishChatUsageReservation).toHaveBeenCalledTimes(1);
      expect(finishChatUsageReservation.mock.calls[0]?.[0]).toMatchObject({
        reservation,
        records: [routerRecord],
        failed: true,
      });
    });

    it("answer generation throws: prepare-time usage is still charged", async () => {
      prepareAnswer.mockImplementationOnce(preparedWithUsage());
      streamChat.mockImplementationOnce(() => {
        throw new Error("provider 500");
      });
      await post({ message: "Tell me about Zenith", source: "widget", visitorId: "visitor01" });

      expect(finishChatUsageReservation).toHaveBeenCalledTimes(1);
      expect(finishChatUsageReservation.mock.calls[0]?.[0]).toMatchObject({ records: [routerRecord], failed: true });
    });

    it("the output check throwing does not lose the answer's usage", async () => {
      envMock.OUTPUT_SCOPE_CHECK = true;
      prepareAnswer.mockImplementationOnce(
        preparedWithUsage({
          guard: {
            reasons: ["flexible"],
            purposeBlock: "# Purpose\nZenith.",
            request: "Tell me about Zenith",
            decision: "in",
            injectionSuspected: false,
            redirect: "I can help with Zenith.",
          } as PreparedAnswer["guard"],
        }),
      );
      generateChat
        .mockResolvedValueOnce({ text: "Zenith has 17 members.", usage })
        .mockRejectedValueOnce(new Error("checker down"));

      const result = await post({ message: "Tell me about Zenith", source: "widget", visitorId: "visitor01" });

      expect(result.text).toBe("Zenith has 17 members.");
      expect(finishChatUsageReservation).toHaveBeenCalledTimes(1);
      const settled = finishChatUsageReservation.mock.calls[0]?.[0] as { records: Array<{ step: string }>; failed: boolean };
      expect(settled.failed).toBe(false);
      expect(settled.records.map((record) => record.step)).toEqual(["rewrite_query", "stream_answer", "output_scope_check"]);
    });

    it("nothing incurred yet: the reservation is released", async () => {
      prepareAnswer.mockRejectedValueOnce(new Error("db down"));
      await post({ message: "Tell me about Zenith", source: "widget", visitorId: "visitor01" });
      expect(finishChatUsageReservation).not.toHaveBeenCalled();
      expect(abortChatUsageReservation).toHaveBeenCalledWith(reservation);
    });

    it("settlement runs exactly once even when settling itself throws", async () => {
      prepareAnswer.mockImplementationOnce(preparedWithUsage({ shouldGenerate: false, fallbackText: "Hello!" }));
      finishChatUsageReservation.mockRejectedValueOnce(new Error("ledger write failed"));
      await post({ message: "Hi", source: "widget", visitorId: "visitor01" });
      expect(finishChatUsageReservation).toHaveBeenCalledTimes(1);
      expect(abortChatUsageReservation).not.toHaveBeenCalled();
    });

    it("a client disconnect mid-stream still settles usage once and persists the answer", async () => {
      prepareAnswer.mockImplementationOnce(preparedWithUsage());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      streamChat.mockReturnValueOnce({
        textStream: (async function* () {
          yield "Zenith has ";
          await gate;
          yield "17 members.";
        })(),
        usage: Promise.resolve(usage),
      });

      const { POST } = await import("./route");
      const response = await POST(
        new Request("http://localhost:3000/api/v1/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assistantId: "asst_public", message: "Members?", source: "widget", visitorId: "visitor01" }),
        }),
      );
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      release();

      await vi.waitFor(() => expect(finishChatUsageReservation).toHaveBeenCalledTimes(1));
      const settled = finishChatUsageReservation.mock.calls[0]?.[0] as { records: Array<{ step: string }>; failed: boolean };
      expect(settled.failed).toBe(false);
      expect(settled.records.map((record) => record.step)).toEqual(["rewrite_query", "stream_answer"]);
      expect(abortChatUsageReservation).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(messageRows()[1]).toMatchObject({ role: "assistant", content: "Zenith has 17 members." }),
      );
    });
  });
});
