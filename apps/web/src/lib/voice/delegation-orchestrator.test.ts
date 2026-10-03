import type { PreparedAnswer } from "@chatai/rag/answer";
import {
  DelegationTracker,
  type AppendResult,
  type VoiceControlChannel,
  type VoiceControlEvent,
} from "@chatai/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn<(row: Record<string, unknown>) => Promise<undefined>>(
  async () => undefined,
);
const updateSet = vi.fn<(patch: Record<string, unknown>) => { where: () => Promise<undefined> }>(
  () => ({ where: vi.fn(async () => undefined) }),
);
vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({ values: insertValues }),
    update: () => ({ set: updateSet }),
  }),
}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/ai-config", () => ({ resolveAssistantModels: vi.fn() }));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginChatUsageReservation: vi.fn(),
  finishChatUsageReservation: vi.fn(),
  abortChatUsageReservation: vi.fn(),
}));
let idSeq = 0;
vi.mock("@/lib/ids", () => ({ createId: () => `id_${++idSeq}` }));

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { serializeVoiceDebug } from "./debug-snapshot";
import {
  finalizeAnsweredTurns,
  isPreScopeEngagement,
  SCOPE_REMINDER_INSTRUCTIONS,
  setVoiceOrchestratorDepsForTests,
  TIMEOUT_COMMENTARY,
  toSpeakableCommentary,
  waitForVoiceTurnsIdle,
  type VoiceOrchestratorDeps,
} from "./delegation-orchestrator";
import { terminateVoiceSession } from "./lifecycle";
import type { VoiceRuntimeSession } from "./session-runtime";
import { superviseSideband } from "./sideband-supervisor";

/** GPT-Live-like channel: supersedes on delegation.created and gates appends. */
class FakeLiveChannel implements VoiceControlChannel {
  readonly providerSessionId = "prov_1";
  readonly delegations = new DelegationTracker();
  readonly commentary: Array<{ delegationId: string; content: string }> = [];
  readonly rejected: Array<{ delegationId: string; reason: string }> = [];
  private listeners = new Set<(event: VoiceControlEvent) => void>();
  private seq = 0;

  subscribe(listener: (event: VoiceControlEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: VoiceControlEvent) {
    for (const listener of this.listeners) listener(event);
  }
  userSays(text: string, startMs: number, endMs = startMs + 400) {
    this.emit({ type: "transcript.input.delta", text, startMs, endMs });
  }
  assistantSays(text: string, startMs: number, endMs = startMs + 400) {
    this.emit({ type: "transcript.output.delta", text, startMs, endMs });
  }
  delegate(id: string, offsetMs: number) {
    this.delegations.supersedeAllActive(offsetMs);
    this.delegations.create(id, offsetMs);
    this.emit({ type: "delegation.created", delegationId: id, offsetMs });
  }
  async appendCommentary(delegationId: string, content: string): Promise<AppendResult> {
    const gate = this.delegations.acceptAppend(delegationId);
    if (!gate.ok) {
      this.rejected.push({ delegationId, reason: gate.reason });
      return { ok: false, reason: gate.reason };
    }
    this.seq += 1;
    this.commentary.push({ delegationId, content });
    return { ok: true, eventId: `evt_${this.seq}` };
  }
  async appendThinking(): Promise<AppendResult> {
    return { ok: true };
  }
  async appendInstructions(): Promise<AppendResult> {
    return { ok: true };
  }
  async close() {
    this.delegations.closeSession();
    return { ok: true as const, reason: "close_requested" as const, usageSeconds: 12 };
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function prepared(query: string, overrides: Partial<PreparedAnswer> = {}): PreparedAnswer {
  return {
    query,
    retrieved: [
      {
        chunkId: "c1",
        documentId: "d1",
        documentName: "pricing.md",
        content: "Pro plan: $20 per month, 5 seats. Business plan: $50 per month.",
        similarity: 0.82,
      },
    ],
    decision: { action: "generate", contextSufficient: true, confidence: "high", mode: "balanced" },
    outcome: "answered_with_context",
    confidence: 0.82,
    system: "SYSTEM",
    shouldGenerate: true,
    fallbackText: "I don't know based on the available information.",
    debug: {},
    providerUsages: [],
    ...overrides,
  } as PreparedAnswer;
}

type PrepareArgs = Parameters<VoiceOrchestratorDeps["prepareAnswer"]>[0];

function setup(options: {
  ephemeral?: boolean;
  prepare?: (args: PrepareArgs) => Promise<PreparedAnswer>;
  answer?: (prompt: string) => string;
  gateOk?: boolean;
  settings?: Partial<VoiceOrchestratorDeps["settings"]>;
} = {}) {
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const prepareAnswer = vi.fn(options.prepare ?? (async (args: PrepareArgs) => prepared(args.message)));
  const generateChat = vi.fn(
    async ({ messages }: { messages: Array<{ role: string; content: string }> }) => {
      const prompt = messages.at(-1)?.content ?? "";
      return {
        text: options.answer ? options.answer(prompt) : `**Answer** to: ${prompt} [1]`,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
  );
  const finishChatUsageReservation = vi.fn(async () => undefined);
  const beginChatUsageReservation = vi.fn(async () =>
    options.gateOk === false
      ? { ok: false as const, status: 402 as const, error: "limit", reason: "limit_exceeded" }
      : { ok: true as const, reservation: null },
  );

  setVoiceOrchestratorDepsForTests({
    prepareAnswer: prepareAnswer as unknown as VoiceOrchestratorDeps["prepareAnswer"],
    generateChat: generateChat as unknown as VoiceOrchestratorDeps["generateChat"],
    resolveAssistantModels: (async () => ({
      chat: { provider: "anthropic", model: "claude", apiKey: "k", baseURL: "" },
      embedding: { provider: "openai", model: "e", apiKey: "k", baseURL: "", dimensions: 1536 },
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
    })) as unknown as VoiceOrchestratorDeps["resolveAssistantModels"],
    beginChatUsageReservation: beginChatUsageReservation as unknown as VoiceOrchestratorDeps["beginChatUsageReservation"],
    finishChatUsageReservation,
    abortChatUsageReservation: vi.fn(async () => undefined),
    settings: { utteranceSettleMaxMs: 0, ...options.settings } as VoiceOrchestratorDeps["settings"],
    log: (event, fields) => logs.push({ event, fields }),
  });

  const channel = new FakeLiveChannel();
  const ephemeral = options.ephemeral ?? true;
  const session: VoiceRuntimeSession = fakeVoiceRuntime({
    ephemeral,
    conversationId: ephemeral ? null : "conv_1",
    durableRowInserted: !ephemeral,
    delegations: channel.delegations,
  });
  superviseSideband(session, channel);
  return { session, channel, prepareAnswer, generateChat, finishChatUsageReservation, beginChatUsageReservation, logs };
}

function messageInserts() {
  return insertValues.mock.calls
    .map((call) => call[0])
    .filter((row) => typeof row.role === "string");
}

describe("voice delegation → prepareAnswer → commentary", () => {
  beforeEach(() => {
    insertValues.mockClear();
    updateSet.mockClear();
    idSeq = 0;
  });
  afterEach(() => {
    setVoiceOrchestratorDepsForTests(null);
  });

  it("runs the full loop: transcript → delegation → prepareAnswer → speakable commentary", async () => {
    const { session, channel, prepareAnswer, logs } = setup();
    channel.userSays("What is ", 1_000);
    channel.userSays("the Pro plan?", 1_400);
    channel.delegate("del_1", 1_900);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer).toHaveBeenCalledTimes(1);
    expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({
      message: "What is the Pro plan?",
      history: [],
      assistantId: "a1",
    });
    expect(channel.commentary).toEqual([
      { delegationId: "del_1", content: "Answer to: What is the Pro plan?" },
    ]);
    const turn = session.turns[0]!;
    expect(turn.status).toBe("answered");
    expect(turn.sources.map((s) => s.documentName)).toEqual(["pricing.md"]);
    expect(turn.metrics.ragStartMs).toBeGreaterThanOrEqual(0);
    expect(turn.metrics.ragDurationMs).toBeGreaterThanOrEqual(0);
    expect(turn.metrics.firstCommentaryMs).toBeGreaterThanOrEqual(turn.metrics.ragStartMs!);

    channel.assistantSays("The Pro plan costs twenty dollars.", 2_600);
    expect(turn.metrics.firstSpeechMs).toBeGreaterThanOrEqual(turn.metrics.firstCommentaryMs!);
    channel.emit({
      type: "append.acknowledged",
      kind: "commentary",
      clientEventId: "evt_1",
      startMs: 2_500,
      endMs: 2_550,
    });
    expect(turn.metrics.commentaryAckMs).toBeGreaterThanOrEqual(0);
    expect(logs.map((l) => l.event)).toEqual(
      expect.arrayContaining(["delegation.created", "turn.answered", "turn.first_speech"]),
    );
    // Structured logs carry timings only — never transcript or answer text.
    expect(JSON.stringify(logs)).not.toContain("Pro plan");
  });

  it("a lookup past the delegation deadline gets a neutral apology; its late result is discarded", async () => {
    const slow = deferred<PreparedAnswer>();
    const { session, channel, logs } = setup({
      prepare: async () => slow.promise,
      settings: { delegationDeadlineMs: 30 },
    });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("failed"));

    expect(session.turns[0]).toMatchObject({ error: "timeout" });
    expect(session.counters.delegationTimeouts).toBe(1);
    await vi.waitFor(() =>
      expect(channel.commentary).toEqual([{ delegationId: "del_1", content: TIMEOUT_COMMENTARY }]),
    );
    expect(logs.some((l) => l.event === "delegation.timeout")).toBe(true);

    slow.resolve(prepared("What is the Pro plan?"));
    await waitForVoiceTurnsIdle(session);
    expect(channel.commentary).toHaveLength(1);
    expect(session.turns[0]!.status).toBe("failed");
  });

  it("a replayed delegation.created (same id) never starts a second lookup", async () => {
    const { session, channel, prepareAnswer } = setup();
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    channel.emit({ type: "delegation.created", delegationId: "del_1", offsetMs: 1_500 });
    await waitForVoiceTurnsIdle(session);
    expect(session.turns).toHaveLength(1);
    expect(prepareAnswer).toHaveBeenCalledTimes(1);
    expect(channel.commentary).toHaveLength(1);
  });

  it("supersedes old RAG work on a new delegation and discards the late result", async () => {
    const first = deferred<PreparedAnswer>();
    let calls = 0;
    const { session, channel, logs } = setup({
      prepare: async (args) => {
        calls += 1;
        return calls === 1 ? first.promise : prepared(args.message);
      },
      // Isolate the provider-driven path from transcript barge-in detection.
      settings: { bargeInMinWords: 99 },
    });

    channel.userSays("Tell me about the Pro plan", 1_000);
    channel.delegate("del_old", 1_500);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("retrieving"));

    channel.userSays("Actually, the Business plan", 3_000);
    channel.delegate("del_new", 3_600);
    await vi.waitFor(() => expect(session.turns[1]?.status).toBe("answered"));

    // Old prepareAnswer finishes late — must never reach GPT-Live.
    first.resolve(prepared("Tell me about the Pro plan"));
    await waitForVoiceTurnsIdle(session);

    expect(channel.commentary.map((c) => c.delegationId)).toEqual(["del_new"]);
    expect(session.turns[0]).toMatchObject({
      status: "superseded",
      supersededBy: "new_delegation",
      lateResultDiscarded: true,
    });
    expect(session.counters).toMatchObject({ superseded: 1, lateResultsDiscarded: 1, answered: 1 });
    expect(logs.some((l) => l.event === "late_result.discarded")).toBe(true);
    // The superseded utterance stays in history for the next query rewrite.
    expect(session.history[0]).toEqual({ role: "user", content: "Tell me about the Pro plan" });
  });

  it("barge-in during RAG cancels the delegation; the next delegation answers", async () => {
    const first = deferred<PreparedAnswer>();
    let calls = 0;
    const { session, channel, finishChatUsageReservation } = setup({
      prepare: async (args) => {
        calls += 1;
        return calls === 1 ? first.promise : prepared(args.message);
      },
    });

    channel.userSays("What is the refund policy", 1_000);
    channel.delegate("del_1", 1_500);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("retrieving"));

    // User keeps talking well after the delegation offset → barge-in.
    channel.userSays("no wait, ", 2_200);
    channel.userSays("what about shipping", 2_500);
    expect(session.turns[0]).toMatchObject({ status: "superseded", supersededBy: "barge_in" });
    expect(session.interruptCount).toBe(1);
    expect(session.counters.bargeIns).toBe(1);

    first.resolve(prepared("refund policy"));
    await waitForVoiceTurnsIdle(session);
    expect(channel.commentary).toEqual([]);
    expect(session.turns[0]!.lateResultDiscarded).toBe(true);
    // Cost of the discarded work is still metered.
    expect(finishChatUsageReservation).toHaveBeenCalledTimes(1);

    channel.delegate("del_2", 3_200);
    await waitForVoiceTurnsIdle(session);
    expect(channel.commentary.map((c) => c.delegationId)).toEqual(["del_2"]);
    expect(session.turns[1]!.userText).toBe("no wait, what about shipping");
  });

  it("the channel gate rejects appends for a delegation superseded by the provider", async () => {
    const gateHold = deferred<void>();
    const { session, channel } = setup({
      prepare: async (args) => {
        await gateHold.promise;
        return prepared(args.message);
      },
    });
    channel.userSays("Pricing?", 1_000);
    channel.delegate("del_1", 1_300);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("retrieving"));

    // Provider-side supersession ChatAI has not observed as an event.
    channel.delegations.supersede("del_1");
    gateHold.resolve();
    await waitForVoiceTurnsIdle(session);

    expect(channel.commentary).toEqual([]);
    expect(channel.rejected).toEqual([{ delegationId: "del_1", reason: "superseded" }]);
    expect(session.counters.appendRejected).toBe(1);
    expect(session.counters.lateResultsDiscarded).toBe(1);
  });

  it("records barge-in during assistant speech and persists the spoken prefix (durable)", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);

    channel.assistantSays("The Pro plan costs twenty dollars ", 2_000, 2_800);
    channel.userSays("okay and ", 2_900);
    channel.userSays("the Business plan?", 3_100);
    const turn = session.turns[0]!;
    expect(turn.interrupted).toBe(true);
    expect(session.interruptCount).toBe(1);

    await finalizeAnsweredTurns(session);
    expect(turn.spokenText).toBe("The Pro plan costs twenty dollars");
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ content: "The Pro plan costs twenty dollars", wasInterrupted: true }),
    );
    // History now reflects what the user actually heard.
    expect(session.history.at(-1)).toEqual({
      role: "assistant",
      content: "The Pro plan costs twenty dollars",
      grounded: true,
    });
  });

  it("attributes only the answer speech (real GPT-Live timeline: filler, stop, non-delegated follow-up)", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays(" What does the Business plan cost", 7_800, 9_400);
    channel.delegate("del_biz", 9_200);
    channel.assistantSays(" Sure,", 9_400, 9_600);
    channel.assistantSays(" checking", 9_800, 10_000);
    await waitForVoiceTurnsIdle(session);
    const turn = session.turns[0]!;
    channel.assistantSays(" the price", 10_400, 10_600);
    channel.assistantSays(".", 10_600, 10_800);
    channel.emit({
      type: "append.acknowledged",
      kind: "commentary",
      clientEventId: turn.commentaryEventId,
      startMs: 10_600,
      endMs: 10_800,
    });
    channel.assistantSays(" The Business", 11_600, 11_800);
    channel.assistantSays(" plan is,", 12_000, 12_600);
    channel.userSays(" Wait", 13_200, 13_400);
    channel.assistantSays(" Sure,", 13_600, 13_800);
    channel.userSays(", stop", 13_800, 14_000);
    channel.assistantSays(" stopping.", 13_800, 14_000);
    // GPT-Live answers this from its own context; no delegation is created.
    channel.userSays(" How many seats does it have", 14_800, 16_600);
    channel.assistantSays(" Twenty five seats.", 16_400, 17_000);

    expect(turn.interrupted).toBe(true);
    await finalizeAnsweredTurns(session);
    expect(turn.spokenText).toBe("The Business plan is,");
    expect(turn.commentaryAckStartMs).toBe(10_600);
  });

  it("durable: voice turns become voice-modality messages on the session conversation", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);

    const rows = messageInserts();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      conversationId: "conv_1",
      role: "user",
      content: "What is the Pro plan?",
      modality: "voice",
      voiceSessionId: "vs_1",
    });
    expect(rows[1]).toMatchObject({
      conversationId: "conv_1",
      role: "assistant",
      modality: "voice",
      outcome: "answered_with_context",
    });
  });

  it("no-store: nothing conversational is written; state is wiped on terminate", async () => {
    const { session, channel } = setup({ ephemeral: true });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    channel.assistantSays("Twenty dollars.", 2_000);

    expect(channel.commentary).toHaveLength(1);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(session.history).toHaveLength(2);

    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: true });
    expect(session.history).toEqual([]);
    expect(session.turns).toEqual([]);
    expect(session.inputFragments).toEqual([]);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("multi-turn: follow-ups reach prepareAnswer with prior voice turns as history", async () => {
    const { session, channel, prepareAnswer } = setup({
      answer: (prompt) =>
        prompt.includes("Tell me about")
          ? "There are two add-ons: Analytics and Priority Support."
          : `Answer to: ${prompt}`,
    });

    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    channel.assistantSays("Pro is our five seat plan.", 2_000);

    channel.userSays("How much is it?", 4_000);
    channel.delegate("del_2", 4_600);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer.mock.calls[1]?.[0]).toMatchObject({
      message: "How much is it?",
      history: [
        { role: "user", content: "What is the Pro plan?" },
        { role: "assistant", content: "Pro is our five seat plan." },
      ],
    });

    channel.userSays("Tell me about the add-ons.", 7_000);
    channel.delegate("del_3", 7_500);
    await waitForVoiceTurnsIdle(session);
    channel.userSays("What about the second one you mentioned?", 10_000);
    channel.delegate("del_4", 10_600);
    await waitForVoiceTurnsIdle(session);

    const lastHistory = prepareAnswer.mock.calls[3]?.[0].history ?? [];
    expect(lastHistory.at(-1)).toEqual({
      role: "assistant",
      content: "There are two add-ons: Analytics and Priority Support.",
    });
    expect(prepareAnswer.mock.calls[3]?.[0].message).toBe("What about the second one you mentioned?");
  });

  it("waits briefly for lagging input transcript after delegation.created", async () => {
    const { session, channel, prepareAnswer } = setup({ settings: { utteranceSettleMaxMs: 500 } });
    channel.delegate("del_1", 1_500);
    setTimeout(() => channel.userSays("Do you ship to Canada?", 1_000, 1_450), 50);
    await waitForVoiceTurnsIdle(session);
    expect(prepareAnswer.mock.calls[0]?.[0].message).toBe("Do you ship to Canada?");
  });

  it("usage limit: no RAG call, spoken apology", async () => {
    const { session, channel, prepareAnswer } = setup({ gateOk: false });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    expect(prepareAnswer).not.toHaveBeenCalled();
    expect(channel.commentary[0]?.content).toMatch(/usage limit/i);
    expect(session.turns[0]!.status).toBe("failed");
  });

  it("keeps a turn GPT-Live answered itself out of the question and passes it as history", async () => {
    const { session, channel, prepareAnswer } = setup();
    channel.userSays(" Hi there, how are you doing today", 1_000, 2_200);
    channel.assistantSays(" I'm doing well, thanks for asking! What can I do for you?", 2_400, 4_600);
    channel.userSays(" What is the Pro plan", 6_200, 7_400);
    channel.delegate("del_1", 7_400);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({
      message: "What is the Pro plan",
      history: [
        { role: "user", content: "Hi there, how are you doing today" },
        { role: "assistant", content: "I'm doing well, thanks for asking! What can I do for you?" },
      ],
    });
    expect(session.turns[0]!.historySupplied).toBe(2);
  });

  it("a barge-in cut-off shorter than a reply does not split the user's question", async () => {
    const { session, channel, prepareAnswer } = setup();
    channel.userSays(" What does the", 1_000, 1_600);
    channel.assistantSays(" Sure", 1_800, 2_000);
    channel.userSays(" Business plan cost", 2_200, 3_200);
    channel.delegate("del_1", 3_200);
    await waitForVoiceTurnsIdle(session);
    expect(prepareAnswer.mock.calls[0]?.[0].message).toBe("What does the Business plan cost");
  });

  it("generates with the shared bounded history and spoken style", async () => {
    const history = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello!" },
      { role: "user" as const, content: "What is the Pro plan?" },
    ];
    const { session, channel, prepareAnswer, generateChat } = setup({
      prepare: async (args) => prepared(args.message, { messages: history }),
    });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer.mock.calls[0]?.[0].responseStyle).toContain("spoken aloud");
    expect(generateChat.mock.calls[0]?.[0]).toMatchObject({ messages: history });
    // No user speech after the delegation: the answer is never held.
    expect(session.turns[0]!.metrics.bargeInHoldMs).toBeUndefined();
  });

  it("holds a ready answer while post-delegation speech is unresolved and drops it on barge-in", async () => {
    const gate = deferred<void>();
    const { session, channel } = setup({
      prepare: async (args) => {
        await gate.promise;
        return prepared(args.message);
      },
      settings: { bargeInSettleMs: 5_000, bargeInHoldMaxMs: 5_000 },
    });
    channel.userSays("What is the refund policy", 1_000);
    channel.delegate("del_1", 1_500);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("retrieving"));

    // One word: not yet a barge-in, but the user has started speaking.
    channel.userSays("wait", 2_200);
    gate.resolve();
    await vi.waitFor(() => expect(session.turns[0]?.answerText).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(channel.commentary).toEqual([]);

    // The speech continues and becomes a real interruption.
    channel.userSays(" what about shipping", 2_600);
    await waitForVoiceTurnsIdle(session);

    expect(channel.commentary).toEqual([]);
    expect(session.turns[0]).toMatchObject({
      status: "superseded",
      supersededBy: "barge_in",
      lateResultDiscarded: true,
    });
  });

  it("a backchannel during the lookup delays the answer only until the speech settles", async () => {
    const gate = deferred<void>();
    const { session, channel } = setup({
      prepare: async (args) => {
        await gate.promise;
        return prepared(args.message);
      },
      settings: { bargeInSettleMs: 80, bargeInHoldMaxMs: 2_000 },
    });
    channel.userSays("What is the refund policy", 1_000);
    channel.delegate("del_1", 1_500);
    await vi.waitFor(() => expect(session.turns[0]?.status).toBe("retrieving"));
    channel.userSays("mm", 2_200);
    gate.resolve();
    await waitForVoiceTurnsIdle(session);

    expect(channel.commentary).toHaveLength(1);
    expect(session.turns[0]!.status).toBe("answered");
    expect(session.turns[0]!.metrics.bargeInHoldMs).toBeGreaterThan(0);
    expect(session.turns[0]!.metrics.bargeInHoldMs).toBeLessThan(2_000);
  });

  it("speech that arrived while collecting and already is a barge-in supersedes before RAG", async () => {
    const { session, channel, prepareAnswer } = setup({ settings: { utteranceSettleMaxMs: 0 } });
    channel.userSays("What is the refund policy", 1_000, 1_400);
    channel.userSays(" no, what about shipping", 2_200, 2_900);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer).not.toHaveBeenCalled();
    expect(channel.commentary).toEqual([]);
    expect(session.turns[0]).toMatchObject({ status: "superseded", supersededBy: "barge_in" });
  });

  it("durable: a turn GPT-Live answered itself is stored in order, without RAG metadata", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays(" Hi there", 1_000, 1_600);
    channel.assistantSays(" Hello! How can I help?", 1_800, 3_200);
    channel.userSays(" What is the Pro plan", 4_000, 5_000);
    channel.delegate("del_1", 5_000);
    await waitForVoiceTurnsIdle(session);

    const rows = messageInserts();
    expect(rows.map((row) => [row.role, row.content])).toEqual([
      ["user", "Hi there"],
      ["assistant", "Hello! How can I help?"],
      ["user", "What is the Pro plan"],
      ["assistant", "Answer to: What is the Pro plan"],
    ]);
    expect(rows[1]).toMatchObject({
      modality: "voice",
      outcome: null,
      debug: { voice: { delegated: false, answeredBy: "realtime_model" } },
    });
    const times = rows.map((row) => (row.createdAt as Date).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("the last live exchange is shown before the call ends and settled on terminate (durable)", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays(" Thanks, that's all", 1_000, 2_000);
    channel.assistantSays(" You're welcome, goodbye!", 2_200, 3_400);

    expect(serializeVoiceDebug(session).exchanges).toEqual([
      expect.objectContaining({
        kind: "live",
        question: "Thanks, that's all",
        answer: "You're welcome, goodbye!",
        settled: false,
      }),
    ]);

    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: true });
    expect(messageInserts().map((row) => [row.role, row.content])).toEqual([
      ["user", "Thanks, that's all"],
      ["assistant", "You're welcome, goodbye!"],
    ]);
  });

  it("no-store: live exchanges join runtime history but are never written", async () => {
    const { session, channel, prepareAnswer } = setup({ ephemeral: true });
    channel.userSays(" Hi there", 1_000, 1_600);
    channel.assistantSays(" Hello! How can I help?", 1_800, 3_200);
    channel.userSays(" What is the Pro plan", 4_000, 5_000);
    channel.delegate("del_1", 5_000);
    await waitForVoiceTurnsIdle(session);

    expect(prepareAnswer.mock.calls[0]?.[0].history).toEqual([
      { role: "user", content: "Hi there" },
      { role: "assistant", content: "Hello! How can I help?" },
    ]);
    channel.userSays(" Bye", 8_000, 8_400);
    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: true });
    expect(insertValues).not.toHaveBeenCalled();
    expect(session.liveExchanges).toEqual([]);
    expect(session.history).toEqual([]);
  });

  it("empty utterance: asks the user to repeat without calling RAG", async () => {
    const { session, channel, prepareAnswer } = setup();
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    expect(prepareAnswer).not.toHaveBeenCalled();
    expect(channel.commentary[0]?.content).toMatch(/repeat/i);
  });
});

describe("Zenith knowledge (fictional, only answerable from the knowledge base)", () => {
  const ZENITH =
    "The fictional Zenith plan costs $73 per month and supports exactly 17 team members. Its internal support code is NZ-4827.";

  function zenithPrepared(args: PrepareArgs): PreparedAnswer {
    const lastAssistant = [...(args.history ?? [])].reverse().find((turn) => turn.role === "assistant");
    const query = /\b(it|its)\b/i.test(args.message) && lastAssistant
      ? `${args.message.replace(/[?.]$/, "")} (Zenith plan)`
      : args.message;
    return prepared(query, {
      retrieved: [
        { chunkId: "zc1", documentId: "zd1", documentName: "Zenith plan", content: ZENITH, similarity: 0.91 },
      ] as PreparedAnswer["retrieved"],
    });
  }

  function zenithAnswer(prompt: string): string {
    if (/support code/i.test(prompt)) return "The Zenith plan's support code is NZ-4827 [1].";
    if (/team members/i.test(prompt)) return "The Zenith plan supports exactly **17** team members [1].";
    return "The Zenith plan costs $73 per month [1].";
  }

  function ack(channel: FakeLiveChannel, turn: VoiceRuntimeSession["turns"][number], startMs: number) {
    channel.emit({
      type: "append.acknowledged",
      kind: "commentary",
      clientEventId: turn.commentaryEventId,
      startMs,
      endMs: startMs + 200,
    });
  }

  beforeEach(() => {
    insertValues.mockClear();
    updateSet.mockClear();
    idSeq = 0;
  });
  afterEach(() => {
    setVoiceOrchestratorDepsForTests(null);
  });

  it("price, team size and support code each go through prepareAnswer; the follow-up uses context", async () => {
    const { session, channel, prepareAnswer } = setup({
      prepare: async (args) => zenithPrepared(args),
      answer: zenithAnswer,
    });

    // Small talk: GPT-Live answers itself.
    channel.userSays(" Hi there, how are you doing today", 1_000, 2_200);
    channel.assistantSays(" Doing well, thanks! What can I help with?", 2_400, 4_400);

    // 1. Price — must reach ChatAI RAG.
    channel.userSays(" How much is the Zenith plan", 6_000, 7_400);
    channel.delegate("del_price", 7_400);
    channel.assistantSays(" Let me check.", 7_800, 8_400);
    await waitForVoiceTurnsIdle(session);
    const price = session.turns[0]!;
    expect(channel.commentary[0]).toEqual({
      delegationId: "del_price",
      content: "The Zenith plan costs $73 per month.",
    });
    ack(channel, price, 9_000);
    channel.assistantSays(" The Zenith plan costs seventy-three dollars per month.", 9_000, 11_400);

    const snapshot = serializeVoiceDebug(session);
    expect(snapshot.turns[0]).toMatchObject({
      delegationId: "del_price",
      status: "answered",
      userText: "How much is the Zenith plan",
      historySupplied: 2,
      rewrittenQuery: "How much is the Zenith plan",
      retrieval: {
        action: "generate",
        contextSufficient: true,
        chunks: [{ documentName: "Zenith plan", similarity: 0.91, preview: ZENITH }],
      },
      groundedAnswer: "The Zenith plan costs $73 per month [1].",
      answerText: "The Zenith plan costs $73 per month.",
      commentary: { eventId: "evt_1", acknowledged: true, ackStartMs: 9_000, rejectReason: null },
      spokenText: "The Zenith plan costs seventy-three dollars per month.",
      outcome: "answered_with_context",
      sources: ["Zenith plan"],
    });

    // 2. Team size — pronoun follow-up; history carries the grounded price answer.
    channel.userSays(" How many team members does it support", 13_000, 14_800);
    channel.delegate("del_team", 14_800);
    await waitForVoiceTurnsIdle(session);
    expect(prepareAnswer.mock.calls[1]?.[0]).toMatchObject({
      message: "How many team members does it support",
      history: expect.arrayContaining([
        { role: "user", content: "How much is the Zenith plan" },
        {
          role: "assistant",
          content: "The Zenith plan costs seventy-three dollars per month.",
          grounded: true,
        },
      ]),
    });
    expect(session.turns[1]!.rewrittenQuery).toBe("How many team members does it support (Zenith plan)");
    expect(channel.commentary[1]).toEqual({
      delegationId: "del_team",
      content: "The Zenith plan supports exactly 17 team members.",
    });
    ack(channel, session.turns[1]!, 15_800);
    channel.assistantSays(" It supports exactly seventeen team members.", 15_800, 17_600);

    // 3. Support code.
    channel.userSays(" What is its support code", 19_000, 20_400);
    channel.delegate("del_code", 20_400);
    await waitForVoiceTurnsIdle(session);
    expect(channel.commentary[2]).toEqual({
      delegationId: "del_code",
      content: "The Zenith plan's support code is NZ-4827.",
    });
    ack(channel, session.turns[2]!, 21_400);
    channel.assistantSays(" The support code is N Z four eight two seven.", 21_400, 23_600);

    // 4. "How much did you say it was again?" — GPT-Live answers from context, no delegation.
    channel.userSays(" How much did you say it was again", 25_000, 26_600);
    channel.assistantSays(" Seventy-three dollars per month.", 26_800, 28_400);
    expect(prepareAnswer).toHaveBeenCalledTimes(3);

    // A later knowledge question is not glued to the context-answered follow-up.
    channel.userSays(" Does it include phone support", 30_000, 31_600);
    channel.delegate("del_phone", 31_600);
    await waitForVoiceTurnsIdle(session);
    const phone = prepareAnswer.mock.calls[3]?.[0];
    expect(phone?.message).toBe("Does it include phone support");
    expect(phone?.history?.slice(-2)).toEqual([
      { role: "user", content: "How much did you say it was again" },
      { role: "assistant", content: "Seventy-three dollars per month." },
    ]);

    // Every exchange is part of the conversation, in spoken order, whether or not RAG ran.
    expect(
      serializeVoiceDebug(session).exchanges.map((exchange) => [exchange.kind, exchange.question]),
    ).toEqual([
      ["live", "Hi there, how are you doing today"],
      ["delegated", "How much is the Zenith plan"],
      ["delegated", "How many team members does it support"],
      ["delegated", "What is its support code"],
      ["live", "How much did you say it was again"],
      ["delegated", "Does it include phone support"],
    ]);
    expect(session.liveExchanges.map((exchange) => exchange.replyText)).toEqual([
      "Doing well, thanks! What can I help with?",
      "Seventy-three dollars per month.",
    ]);

    await finalizeAnsweredTurns(session);
    expect(session.turns.slice(0, 3).map((turn) => turn.spokenText)).toEqual([
      "The Zenith plan costs seventy-three dollars per month.",
      "It supports exactly seventeen team members.",
      "The support code is N Z four eight two seven.",
    ]);
    expect(channel.commentary.map((c) => c.delegationId)).toEqual([
      "del_price",
      "del_team",
      "del_code",
      "del_phone",
    ]);
  });
});

describe("toSpeakableCommentary", () => {
  it("strips citations and markdown and respects the append budget", () => {
    expect(toSpeakableCommentary("**Pro** costs $20 [1]. See [docs](https://x.y).", 1_800)).toBe(
      "Pro costs $20. See docs.",
    );
    const long = "Sentence one is here. ".repeat(200);
    const spoken = toSpeakableCommentary(long, 1_800);
    expect(spoken.length).toBeLessThanOrEqual(1_800);
    expect(spoken.endsWith(".")).toBe(true);
  });
});

describe("Voice turn audio offsets (review navigation only)", () => {
  beforeEach(() => {
    insertValues.mockClear();
    updateSet.mockClear();
    idSeq = 0;
  });
  afterEach(() => {
    setVoiceOrchestratorDepsForTests(null);
  });

  function offsetUpdates() {
    return updateSet.mock.calls.map((call) => call[0]).filter((patch) => "audioOffsetMs" in patch);
  }

  it("durable: user turn offset is the utterance start; the answer offset is where speech starts", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays("What is ", 1_000);
    channel.userSays("the Pro plan?", 1_400);
    channel.delegate("del_1", 1_900);
    await waitForVoiceTurnsIdle(session);

    const [user, assistant] = messageInserts();
    expect(user).toMatchObject({ role: "user", voiceSessionId: "vs_1", audioOffsetMs: 1_000 });
    // Not spoken yet when inserted: no offset is guessed.
    expect(assistant).toMatchObject({ role: "assistant", voiceSessionId: "vs_1" });
    expect(assistant?.audioOffsetMs).toBeUndefined();

    channel.emit({ type: "append.acknowledged", kind: "commentary", clientEventId: "evt_1", startMs: 2_500, endMs: 2_550 });
    channel.assistantSays("Filler before the answer.", 2_300);
    channel.assistantSays("The Pro plan costs twenty dollars.", 2_600);
    await finalizeAnsweredTurns(session);
    expect(offsetUpdates()).toEqual([
      expect.objectContaining({ content: "The Pro plan costs twenty dollars.", audioOffsetMs: 2_600 }),
    ]);
  });

  it("durable: a turn GPT-Live answered itself stores user and reply offsets", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays(" Hi there", 1_000, 1_600);
    channel.assistantSays(" Hello! How can I help?", 1_800, 3_200);
    channel.userSays(" What is the Pro plan", 4_000, 5_000);
    channel.delegate("del_1", 5_000);
    await waitForVoiceTurnsIdle(session);

    expect(messageInserts().map((row) => [row.role, row.audioOffsetMs])).toEqual([
      ["user", 1_000],
      ["assistant", 1_800],
      ["user", 4_000],
      ["assistant", undefined],
    ]);
  });

  it("malformed provider offsets are stored as NULL, never guessed", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays("What is the Pro plan?", -5_000);
    channel.delegate("del_1", -4_000);
    await waitForVoiceTurnsIdle(session);
    channel.assistantSays("Twenty dollars.", 9_000_000_000);
    await finalizeAnsweredTurns(session);

    expect(messageInserts()[0]).toMatchObject({ role: "user", audioOffsetMs: null });
    const spoken = updateSet.mock.calls.map((call) => call[0]).find((patch) => "content" in patch);
    expect(spoken).toMatchObject({ content: "Twenty dollars." });
    expect(spoken).not.toHaveProperty("audioOffsetMs");
  });

  it("no-store: offsets are never persisted", async () => {
    const { session, channel } = setup({ ephemeral: true });
    channel.userSays(" Hi there", 1_000, 1_600);
    channel.assistantSays(" Hello!", 1_800, 2_400);
    channel.userSays("What is the Pro plan?", 3_000);
    channel.delegate("del_1", 3_500);
    await waitForVoiceTurnsIdle(session);
    channel.emit({ type: "append.acknowledged", kind: "commentary", clientEventId: "evt_1", startMs: 4_000, endMs: 4_050 });
    channel.assistantSays("Twenty dollars.", 4_100);
    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: true });

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("durable lifecycle events carry a wall-clock offset from session start", async () => {
    const { session, channel } = setup({ ephemeral: false });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    await vi.waitFor(() =>
      expect(insertValues.mock.calls.some((call) => call[0].type === "rag.completed")).toBe(true),
    );

    const events = insertValues.mock.calls.map((call) => call[0]).filter((row) => typeof row.type === "string");
    expect(events.map((row) => row.type)).toEqual(expect.arrayContaining(["rag.started", "rag.completed"]));
    for (const event of events) {
      expect(typeof event.offsetMs).toBe("number");
      expect(event.offsetMs as number).toBeGreaterThanOrEqual(0);
      expect(event.offsetMs as number).toBeLessThan(60_000);
    }
  });
});

describe("voice scope enforcement (shared ChatAI policy)", () => {
  const REDIRECT = "I can help with appointments, services and opening hours. Is there something about Bright Smile Dental Clinic I can help you with?";
  const outOfScope = (query: string) =>
    prepared(query, {
      outcome: "out_of_scope",
      shouldGenerate: false,
      fallbackText: REDIRECT,
      retrieved: [],
      turn: { kind: "knowledge", retrieval: "skipped" },
      scope: { decision: "out", plannerMs: 320, plannerWaitMs: 0, redirectSource: "template" },
    });

  beforeEach(() => {
    insertValues.mockClear();
    updateSet.mockClear();
    idSeq = 0;
  });
  afterEach(() => {
    setVoiceOrchestratorDepsForTests(null);
  });

  it("a delegated unrelated question gets the shared redirect as commentary, without generation", async () => {
    const { session, channel, prepareAnswer, generateChat, logs } = setup({
      prepare: async (args) => outOfScope(args.message),
    });
    session.assistant = { ...session.assistant!, name: "Smile Desk", instructions: "Clinic receptionist." };
    channel.userSays("What's the best laptop for gaming?", 1_000);
    channel.delegate("del_1", 1_600);
    await waitForVoiceTurnsIdle(session);

    // Same scope inputs as the Text route: assistant name, Instructions, mode, message, history.
    expect(prepareAnswer.mock.calls[0]?.[0]).toMatchObject({
      assistantName: "Smile Desk",
      instructions: "Clinic receptionist.",
      mode: "balanced",
      message: "What's the best laptop for gaming?",
    });
    expect(generateChat).not.toHaveBeenCalled();
    expect(channel.commentary).toEqual([{ delegationId: "del_1", content: REDIRECT }]);
    const turn = session.turns[0]!;
    expect(turn).toMatchObject({ status: "answered", outcome: "out_of_scope" });
    expect(turn.metrics).toMatchObject({ scopeDecision: "out", plannerMs: 320, plannerWaitMs: 0 });
    // Marked so the next turn's risk gate sees the recent redirect.
    expect(session.history.at(-1)).toEqual({ role: "assistant", content: REDIRECT, redirected: true });

    const answered = logs.find((entry) => entry.event === "turn.answered");
    expect(answered?.fields).toMatchObject({ outcome: "out_of_scope", scopeDecision: "out", plannerMs: 320 });
    expect(JSON.stringify(logs)).not.toMatch(/laptop|Bright Smile/);
  });

  it("in-scope delegations record the classifier timings on the turn", async () => {
    const { session, channel } = setup({
      prepare: async (args) => prepared(args.message, { scope: { decision: "in", plannerMs: 280, plannerWaitMs: 40 } }),
    });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    expect(session.turns[0]!.metrics).toMatchObject({ scopeDecision: "in", plannerMs: 280, plannerWaitMs: 40 });
  });

  it("audit only: a substantive live answer is logged as numbers and triggers one throttled reminder", async () => {
    const { channel, logs } = setup();
    const reminders = vi.spyOn(channel, "appendInstructions");
    const longReply = ` ${"For gaming you want a strong graphics card and a fast screen. ".repeat(3)}`;
    channel.userSays(" What's the best laptop for gaming", 1_000, 2_000);
    channel.assistantSays(longReply, 2_200, 9_000);
    channel.userSays(" And which mouse should I get", 10_000, 11_000);
    channel.assistantSays(longReply, 11_200, 18_000);
    channel.userSays(" Okay", 19_000, 19_400);

    await vi.waitFor(() =>
      expect(logs.filter((entry) => entry.event === "voice.live_substantive")).toHaveLength(2),
    );
    const flagged = logs.filter((entry) => entry.event === "voice.live_substantive").map((entry) => entry.fields);
    expect(flagged[0]).toEqual({ sessionId: "vs_1", userWords: 6, replyWords: 36, reminded: true });
    expect(flagged[1]).toMatchObject({ reminded: false });
    expect(reminders).toHaveBeenCalledTimes(1);
    expect((reminders.mock.calls[0] as unknown[] | undefined)?.[0]).toBe(SCOPE_REMINDER_INSTRUCTIONS);
    expect(JSON.stringify(logs)).not.toMatch(/laptop|mouse|graphics/);
  });

  it("the audit is not the enforcement boundary: short live answers and social protocol are not flagged", async () => {
    const { session, channel, logs } = setup();
    const reminders = vi.spyOn(channel, "appendInstructions");
    channel.userSays(" What's two plus two", 1_000, 2_000);
    channel.assistantSays(" It's four.", 2_200, 3_000);
    channel.userSays(" Thanks so much", 4_000, 5_000);
    channel.assistantSays(` ${"You are very welcome, it was a pleasure talking with you today. ".repeat(3)}`, 5_200, 12_000);
    channel.userSays(" Bye", 13_000, 13_400);
    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: false });
    // A short unrelated live answer is still a bypass; prevention is delegation + backend scope.
    expect(logs.some((entry) => entry.event === "voice.live_substantive")).toBe(false);
    expect(reminders).not.toHaveBeenCalled();
  });

  it("a live reply that engages with an activity is a pre-scope engagement failure (numbers only)", async () => {
    const { session, channel, logs } = setup();
    const reminders = vi.spyOn(channel, "appendInstructions");
    channel.userSays(" I want to cook today, can you help me", 1_000, 2_000);
    channel.assistantSays(" Sure! What would you like to cook?", 2_200, 3_500);
    channel.userSays(" Okay", 5_000, 5_400);

    await vi.waitFor(() => expect(logs.some((entry) => entry.event === "voice.pre_scope_engagement")).toBe(true));
    expect(logs.find((entry) => entry.event === "voice.live_nonsocial")?.fields).toMatchObject({ sessionId: "vs_1" });
    expect(logs.find((entry) => entry.event === "voice.pre_scope_engagement")?.fields).toEqual({
      sessionId: "vs_1",
      stage: "live_reply",
      replyWords: expect.any(Number),
    });
    expect(reminders).toHaveBeenCalledTimes(1);

    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: false });
    const summary = logs.find((entry) => entry.event === "voice.delegation_latency");
    expect(summary?.fields).toMatchObject({ answered: 0, liveNonsocial: 1, preScopeEngagement: 1 });
    expect(JSON.stringify(logs)).not.toMatch(/cook/);
  });

  it("engagement words spoken before the backend reply are flagged on the turn", async () => {
    const { session, channel, logs } = setup({ prepare: async (args) => outOfScope(args.message) });
    channel.userSays("I want to plan a trip to Rome", 1_000, 2_000);
    channel.assistantSays(" Absolutely, I'd be happy to help.", 2_100, 2_900);
    channel.delegate("del_1", 3_000);
    await waitForVoiceTurnsIdle(session);

    expect(session.turns[0]!.metrics.preScopeEngagement).toBe(true);
    expect(logs.find((entry) => entry.event === "voice.pre_scope_engagement")?.fields).toMatchObject({
      stage: "before_backend_reply",
      scopeDecision: "out",
    });
  });

  it("the neutral acknowledgement is not engagement", () => {
    expect(isPreScopeEngagement("One moment.")).toBe(false);
    expect(isPreScopeEngagement("Just a moment please")).toBe(false);
    expect(isPreScopeEngagement("Sure.")).toBe(true);
    expect(isPreScopeEngagement("I can help with that.")).toBe(true);
    expect(isPreScopeEngagement("What kind of laptop are you looking for?")).toBe(true);
    expect(isPreScopeEngagement("Hello!")).toBe(false);
  });

  it("logs one numeric delegation latency summary per session, grouped by scope decision", async () => {
    let call = 0;
    const { session, channel, logs } = setup({
      prepare: async (args) =>
        ++call === 1
          ? prepared(args.message, { scope: { decision: "in", plannerMs: 250, plannerWaitMs: 0 } })
          : outOfScope(args.message),
    });
    channel.userSays("What is the Pro plan?", 1_000);
    channel.delegate("del_1", 1_500);
    await waitForVoiceTurnsIdle(session);
    channel.assistantSays("Twenty dollars.", 2_500, 3_000);
    channel.userSays("What's the best laptop?", 5_000);
    channel.delegate("del_2", 5_600);
    await waitForVoiceTurnsIdle(session);

    await terminateVoiceSession(session, { reason: "close_requested", requestProviderClose: true });
    const summaries = logs.filter((entry) => entry.event === "voice.delegation_latency");
    expect(summaries).toHaveLength(1);
    const fields = summaries[0]!.fields as {
      answered: number;
      byScope: Record<string, Record<string, { n: number; p50: number; p95: number } | null>>;
    };
    expect(fields.answered).toBe(2);
    expect(Object.keys(fields.byScope).sort()).toEqual(["all", "in", "out"]);
    expect(fields.byScope.all!.firstCommentaryMs).toMatchObject({ n: 2 });
    expect(fields.byScope.in!.plannerMs).toEqual({ n: 1, p50: 250, p95: 250 });
    expect(fields.byScope.out!.plannerMs).toEqual({ n: 1, p50: 320, p95: 320 });
    expect(JSON.stringify(summaries)).not.toMatch(/Pro plan|laptop|dollars/);
  });
});
