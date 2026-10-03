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
vi.mock("@/lib/api-keys", () => ({ usesApiKeyAuth: () => false }));
vi.mock("@/lib/authorize-v1", () => ({ authorizeV1: vi.fn() }));
vi.mock("@/lib/assistants", () => ({ getOwnedAssistantByRef: vi.fn() }));
vi.mock("@/lib/eval-worker", () => ({ startEvalWorker: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ consumeApiKeyRateLimit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ user: { id: "user_1" } }) }));
vi.mock("@/lib/hosting/accounts", () => ({
  resolveBillableAccountForAssistant: async () => ({ id: "acct_1", status: "active" }),
  checkHostingAccountAccess: () => ({ ok: true }),
}));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: async () => ({ ok: true, reservation: null }),
  finishChatUsageReservation: async () => undefined,
  abortChatUsageReservation: async () => undefined,
}));
vi.mock("@/lib/policies/security-policy", () => ({
  SecurityPolicy: { fromAssistant: () => ({ enforceWidgetRequest: async () => null }) },
}));
vi.mock("@/lib/ai-config", () => ({
  resolveAssistantModels: async () => ({
    chat: { provider: "openai", model: "gpt", apiKey: "k", baseURL: "" },
    embedding: { provider: "openai", model: "e", apiKey: "k", baseURL: "", dimensions: 3 },
    billing: {},
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
  const events = (await response.text())
    .split("\n\n")
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice(5)) as Row);
  return {
    status: response.status,
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
    expect(result.text).toBe("Zenith was founded in 2011.");
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
      { role: "assistant", content: "Zenith has 17 members." },
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
});
