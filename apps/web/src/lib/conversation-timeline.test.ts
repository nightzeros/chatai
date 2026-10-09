import { describe, expect, it } from "vitest";

import {
  buildConversationTimeline,
  voiceCallEnd,
  voiceCallUsageLabel,
  voiceTurnDetails,
  type ReviewMessageRecord,
  type TimelineEntry,
  type VoiceCallRecord,
  type VoiceRecordingRecord,
} from "./conversation-timeline";

const T0 = Date.parse("2026-09-28T15:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

let seq = 0;
function message(overrides: Partial<ReviewMessageRecord>): ReviewMessageRecord {
  seq += 1;
  return {
    id: `m${seq}`,
    role: "user",
    content: `message ${seq}`,
    sources: [],
    outcome: null,
    feedback: null,
    confidence: null,
    modality: "text",
    wasInterrupted: false,
    voiceSessionId: null,
    audioOffsetMs: null,
    latencyMs: null,
    debug: null,
    createdAt: at(seq),
    ...overrides,
  };
}

function call(id: string, overrides: Partial<VoiceCallRecord> = {}): VoiceCallRecord {
  return {
    id,
    source: "widget",
    status: "ended",
    startedAt: at(0),
    endedAt: at(60),
    durationMs: 60_000,
    errorCode: null,
    interruptCount: 0,
    voiceSeconds: 61,
    meteringStatus: "settled",
    quotaExempt: false,
    ...overrides,
  };
}

function recording(id: string, sessionId: string, overrides: Partial<VoiceRecordingRecord> = {}): VoiceRecordingRecord {
  return {
    id,
    sessionId,
    status: "ready",
    partial: false,
    durationMs: 60_000,
    createdAt: at(61).toISOString(),
    timelineVersion: 1,
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  };
}

type CallEntry = Extract<TimelineEntry, { kind: "call" }>;

function shape(entries: TimelineEntry[]) {
  return entries.map((entry) =>
    entry.kind === "call"
      ? { call: entry.call.id, turns: entry.turns.map((turn) => turn.content) }
      : { message: entry.message.content },
  );
}

describe("buildConversationTimeline", () => {
  it("nests Voice turns under the call named by voiceSessionId, not by timestamp", () => {
    // Call B's window contains a turn that belongs to call A (authoritative link wins).
    const a = call("vs_a", { startedAt: at(10), endedAt: at(20) });
    const b = call("vs_b", { startedAt: at(30), endedAt: at(40) });
    const entries = buildConversationTimeline({
      calls: [a, b],
      recordings: [],
      messages: [
        message({ content: "A1", modality: "voice", voiceSessionId: "vs_a", createdAt: at(12) }),
        message({ content: "late A", modality: "voice", voiceSessionId: "vs_a", createdAt: at(35) }),
        message({ content: "B1", modality: "voice", voiceSessionId: "vs_b", createdAt: at(32) }),
      ],
    });
    expect(shape(entries)).toEqual([
      { call: "vs_a", turns: ["A1", "late A"] },
      { call: "vs_b", turns: ["B1"] },
    ]);
  });

  it("mixed conversation: text between separate Voice calls keeps its place", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(10) }), call("vs_2", { startedAt: at(100) })],
      recordings: [],
      messages: [
        message({ content: "typed hello", createdAt: at(1) }),
        message({ content: "typed reply", role: "assistant", createdAt: at(2) }),
        message({ content: "voice q1", modality: "voice", voiceSessionId: "vs_1", createdAt: at(12) }),
        message({ content: "voice a1", role: "assistant", modality: "voice", voiceSessionId: "vs_1", createdAt: at(14) }),
        message({ content: "typed between", createdAt: at(50) }),
        message({ content: "voice q2", modality: "voice", voiceSessionId: "vs_2", createdAt: at(102) }),
        message({ content: "typed after", createdAt: at(200) }),
      ],
    });
    expect(shape(entries)).toEqual([
      { message: "typed hello" },
      { message: "typed reply" },
      { call: "vs_1", turns: ["voice q1", "voice a1"] },
      { message: "typed between" },
      { call: "vs_2", turns: ["voice q2"] },
      { message: "typed after" },
    ]);
  });

  it("multiple calls each get their own recording; unrelated recordings never attach", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(10) }), call("vs_2", { startedAt: at(100) }), call("vs_3", { startedAt: at(200) })],
      recordings: [
        recording("rec_1", "vs_1"),
        recording("rec_2_failed", "vs_2", { status: "failed", createdAt: at(300).toISOString() }),
        recording("rec_2_ready", "vs_2", { createdAt: at(150).toISOString() }),
        recording("rec_other", "vs_elsewhere"),
      ],
      messages: [],
    });
    const calls = entries as CallEntry[];
    expect(calls.map((entry) => [entry.call.id, entry.recording?.id ?? null])).toEqual([
      ["vs_1", "rec_1"],
      ["vs_2", "rec_2_ready"],
      ["vs_3", null],
    ]);
    expect(calls[0]!.recording).not.toHaveProperty("sessionId");
    expect(calls.every((entry) => entry.turns.length === 0)).toBe(true);
  });

  it("each call's recording carries its own timeline version (V1 and V2 side by side)", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(10) }), call("vs_2", { startedAt: at(100) })],
      recordings: [recording("rec_v1", "vs_1"), recording("rec_v2", "vs_2", { timelineVersion: 2 })],
      messages: [],
    });
    expect((entries as CallEntry[]).map((entry) => entry.recording?.timelineVersion)).toEqual([1, 2]);
  });

  it("keeps valid offsets, NULL for legacy rows, and drops malformed ones", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1")],
      recordings: [recording("rec_1", "vs_1", { partial: true, durationMs: 28_900 })],
      messages: [
        message({ content: "valid", modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: 4_000 }),
        message({ content: "outside partial", modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: 45_000 }),
        message({ content: "legacy", modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: null }),
        message({ content: "negative", modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: -9_000 }),
        message({ content: "huge", modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: 99_999_999_999 }),
      ],
    });
    const [entry] = entries as CallEntry[];
    expect(entry!.turns.map((turn) => [turn.content, turn.audioOffsetMs])).toEqual([
      ["valid", 4_000],
      // Range is judged by the player against the recording; the offset itself is valid.
      ["outside partial", 45_000],
      ["legacy", null],
      ["negative", null],
      ["huge", null],
    ]);
    expect(entry!.recording).toMatchObject({ partial: true, durationMs: 28_900 });
  });

  it("a Voice turn without a known call is shown on its own, without playback", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(0) })],
      recordings: [recording("rec_1", "vs_1")],
      messages: [
        message({ content: "unlinked", modality: "voice", voiceSessionId: null, audioOffsetMs: 1_000, createdAt: at(5) }),
        message({ content: "deleted call", modality: "voice", voiceSessionId: "vs_gone", audioOffsetMs: 2_000, createdAt: at(6) }),
      ],
    });
    expect(shape(entries)).toEqual([
      { call: "vs_1", turns: [] },
      { message: "unlinked" },
      { message: "deleted call" },
    ]);
    for (const entry of entries) {
      if (entry.kind === "message") expect(entry.message.audioOffsetMs).toBeNull();
    }
  });

  it("text messages are never pulled into a call even with a session id", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(0) })],
      recordings: [],
      messages: [message({ content: "typed", modality: "text", voiceSessionId: "vs_1", createdAt: at(5) })],
    });
    expect(shape(entries)).toEqual([{ call: "vs_1", turns: [] }, { message: "typed" }]);
  });

  it("never exposes raw debug, provider cost or provider seconds", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { voiceSeconds: 181 })],
      recordings: [],
      messages: [
        message({ content: "What is the Zenith plan?", modality: "voice", voiceSessionId: "vs_1" }),
        message({
          role: "assistant",
          content: "It costs $73.",
          modality: "voice",
          voiceSessionId: "vs_1",
          debug: {
            provider: "anthropic",
            model: "claude-internal",
            retrieval: [{ chunkId: "chunk_secret", documentId: "d1", documentName: "Zenith plan", similarity: 0.91 }],
            voice: { delegationId: "del_1", rewrittenQuery: "Zenith plan price", metrics: { firstCommentaryMs: 2100 } },
          },
        }),
      ],
    });
    const json = JSON.stringify(entries);
    for (const secret of ["chunk_secret", "claude-internal", "anthropic", "similarity", "del_1", "billableSeconds"]) {
      expect(json).not.toContain(secret);
    }
    expect(json).toContain("3m 1s of Voice time");
  });

  it("a Voice answer shows what was spoken; text turns and legacy rows show content", () => {
    const entries = buildConversationTimeline({
      calls: [call("vs_1", { startedAt: at(0) })],
      recordings: [],
      messages: [
        message({
          role: "assistant",
          content: "The Pro plan costs $20 per month.",
          modality: "voice",
          voiceSessionId: "vs_1",
          audioOffsetMs: 4_000,
          createdAt: at(4),
          debug: { voice: { delegationId: "del_1", spokenText: "Twenty dollars a month." } },
        }),
        message({ role: "assistant", content: "Legacy spoken row.", modality: "voice", voiceSessionId: "vs_1", createdAt: at(8) }),
        message({
          role: "assistant",
          content: "Typed answer.",
          modality: "text",
          createdAt: at(50),
          debug: { voice: { spokenText: "never shown" } },
        }),
      ],
    });
    expect(shape(entries)).toEqual([
      { call: "vs_1", turns: ["Twenty dollars a month.", "Legacy spoken row."] },
      { message: "Typed answer." },
    ]);
    const turn = entries[0]?.kind === "call" ? entries[0].turns[0] : null;
    expect(turn?.audioOffsetMs).toBe(4_000);
  });
});

describe("voiceTurnDetails", () => {
  const knowledgeDebug = {
    retrieval: [
      { documentName: "Pricing" },
      { documentName: "Pricing" },
      { documentName: "Plans" },
      { documentName: "" },
      { nope: true },
    ],
    voice: {
      delegationId: "del_1",
      rewrittenQuery: "Business plan price per month",
      metrics: { firstCommentaryMs: 2_140, ragDurationMs: 820, firstSpeechMs: -1 },
    },
  };

  it("summarizes a ChatAI Knowledge answer for the owner", () => {
    expect(
      voiceTurnDetails(
        { role: "assistant", modality: "voice", debug: knowledgeDebug, wasInterrupted: true },
        "how much is it",
      ),
    ).toEqual({
      answeredBy: "knowledge",
      searchQuery: "Business plan price per month",
      matchedDocuments: ["Pricing", "Plans"],
      answerReadyMs: 2_140,
      lookupMs: 820,
      interrupted: true,
      serverForced: false,
      withheldText: null,
    });
  });

  it("marks server-forced lookups and keeps withheld live replies apart from heard speech", () => {
    const forced = voiceTurnDetails(
      {
        role: "assistant",
        modality: "voice",
        debug: {
          ...knowledgeDebug,
          voice: {
            ...knowledgeDebug.voice,
            delegationId: null,
            turnId: "srv_1",
            origin: "server",
            withheldText: "Food is great!",
          },
        },
        wasInterrupted: false,
      },
      "I'm hungry",
    );
    expect(forced).toMatchObject({ answeredBy: "knowledge", serverForced: true, withheldText: "Food is great!" });

    expect(
      voiceTurnDetails(
        { role: "user", modality: "voice", debug: { voice: { withheldText: "  Let me tell you about pasta.  " } }, wasInterrupted: false },
        null,
      ),
    ).toEqual({
      answeredBy: null,
      searchQuery: null,
      matchedDocuments: [],
      answerReadyMs: null,
      lookupMs: null,
      interrupted: false,
      serverForced: false,
      withheldText: "Let me tell you about pasta.",
    });
  });

  it("hides the search query when it just repeats what the visitor said", () => {
    const details = voiceTurnDetails(
      { role: "assistant", modality: "voice", debug: knowledgeDebug, wasInterrupted: false },
      "Business plan: price per month?",
    );
    expect(details?.searchQuery).toBeNull();
  });

  it("marks Voice model replies and ignores user/text turns", () => {
    expect(
      voiceTurnDetails(
        {
          role: "assistant",
          modality: "voice",
          debug: { voice: { delegated: false, answeredBy: "realtime_model" } },
          wasInterrupted: false,
        },
        "hi",
      ),
    ).toMatchObject({ answeredBy: "voice_model", searchQuery: null, matchedDocuments: [] });
    expect(voiceTurnDetails({ role: "user", modality: "voice", debug: null, wasInterrupted: false }, null)).toBeNull();
    expect(
      voiceTurnDetails({ role: "assistant", modality: "text", debug: knowledgeDebug, wasInterrupted: false }, null),
    ).toBeNull();
  });

  it("tolerates missing or malformed debug", () => {
    for (const debug of [null, "x", [], { voice: "nope" }, { voice: { metrics: "bad" } }]) {
      expect(
        voiceTurnDetails({ role: "assistant", modality: "voice", debug, wasInterrupted: false }, null),
      ).toMatchObject({ answeredBy: null, searchQuery: null, matchedDocuments: [], answerReadyMs: null });
    }
  });
});

describe("call labels", () => {
  it("explains how each call ended to the owner (usage_limit stays explicit)", () => {
    expect(voiceCallEnd({ status: "ended", errorCode: "usage_limit" }).label).toMatch(/Voice minutes used up/);
    expect(voiceCallEnd({ status: "ended", errorCode: "runtime_lost" })).toMatchObject({ tone: "error" });
    expect(voiceCallEnd({ status: "ended", errorCode: null })).toEqual({ inProgress: false, label: "Ended", tone: "default" });
    expect(voiceCallEnd({ status: "connected", errorCode: null })).toMatchObject({ inProgress: true });
    expect(voiceCallEnd({ status: "failed", errorCode: "something_new" }).label).toBe("Ended with an error");
  });

  it("shows customer Voice time only", () => {
    expect(voiceCallUsageLabel({ quotaExempt: false, meteringStatus: "settled", voiceSeconds: 181 })).toBe(
      "3m 1s of Voice time",
    );
    expect(voiceCallUsageLabel({ quotaExempt: false, meteringStatus: "estimated", voiceSeconds: 15 })).toBe(
      "15s of Voice time (estimated)",
    );
    expect(voiceCallUsageLabel({ quotaExempt: true, meteringStatus: "settled", voiceSeconds: 40 })).toMatch(
      /not counted toward Voice minutes/,
    );
    expect(voiceCallUsageLabel({ quotaExempt: false, meteringStatus: "open", voiceSeconds: null })).toBeNull();
    expect(voiceCallUsageLabel({ quotaExempt: false, meteringStatus: "legacy", voiceSeconds: null })).toBeNull();
  });
});
