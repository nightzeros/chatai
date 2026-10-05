import {
  assistants,
  conversations,
  messages,
  user,
  voiceRecordings,
  voiceSessions,
  type Database,
} from "@chatai/database";
import { createTestDatabase } from "@chatai/database/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  session: null as { user: { id: string } } | null,
}));

vi.mock("@/lib/db", () => ({ db: () => state.db }));
vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: "postgres://unused" } }));
vi.mock("@/lib/session", () => ({
  requireSession: async () => {
    if (!state.session) throw new Error("unauthenticated");
    return state.session;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import type { TimelineEntry } from "@/lib/conversation-timeline";
import { getOwnedConversationReview } from "@/lib/conversation-review";
import {
  getOwnedConversationTranscript,
  listOwnedConversationReviewItems,
  listOwnedConversations,
} from "@/lib/conversations";
import { fakeVoiceRuntime } from "@/lib/voice/__fixtures__/runtime";
import {
  insertDurableVoiceSessionRow,
  insertOperationalVoiceSessionRow,
  insertVoiceLiveExchange,
  insertVoiceUserMessage,
} from "@/lib/voice/persist";
import type { VoiceTurn } from "@/lib/voice/session-runtime";
import ConversationTranscriptPage from "@/app/dashboard/assistants/[id]/conversations/[conversationId]/page";
import ConversationsPage from "@/app/dashboard/assistants/[id]/conversations/page";

let db: Database;
let close: () => Promise<void>;
let seq = 0;

const T0 = Date.parse("2026-09-28T15:00:00.000Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(() => {
  state.session = null;
});

async function owner() {
  seq += 1;
  const userId = `u_${seq}`;
  const assistantId = `a_${seq}`;
  await db.insert(user).values({ id: userId, name: "Owner", email: `owner${seq}@example.com` });
  await db.insert(assistants).values({ id: assistantId, publicId: `pub_${seq}`, userId, name: "Bot" });
  return { userId, assistantId };
}

async function conversation(assistantId: string, id: string, updatedAt = at(0)) {
  await db.insert(conversations).values({ id, assistantId, source: "widget", visitorId: "visitor-abcdef", updatedAt });
}

async function session(
  assistantId: string,
  id: string,
  conversationId: string | null,
  overrides: Partial<typeof voiceSessions.$inferInsert> = {},
) {
  await db.insert(voiceSessions).values({
    id,
    assistantId,
    conversationId,
    provider: "mock",
    source: "widget",
    status: "ended",
    startedAt: at(0),
    durationMs: 60_000,
    meteringStatus: "settled",
    voiceSeconds: 61,
    ...overrides,
  });
}

async function message(
  conversationId: string,
  id: string,
  createdAt: Date,
  overrides: Partial<typeof messages.$inferInsert> = {},
) {
  await db.insert(messages).values({ id, conversationId, role: "user", content: id, createdAt, ...overrides });
}

function shape(entries: TimelineEntry[]) {
  return entries.map((entry) =>
    entry.kind === "call"
      ? { call: entry.call.id, recording: entry.recording?.id ?? null, turns: entry.turns.map((t) => [t.id, t.audioOffsetMs]) }
      : { message: entry.message.id },
  );
}

describe("owner conversation review (PGlite)", () => {
  it("groups Voice turns by their stored call, with text between calls and offsets", async () => {
    const { userId, assistantId } = await owner();
    await conversation(assistantId, "c_mixed");
    await session(assistantId, "vs_1", "c_mixed", { startedAt: at(10) });
    await session(assistantId, "vs_2", "c_mixed", { startedAt: at(100), errorCode: "usage_limit" });
    await db.insert(voiceRecordings).values({
      id: "rec_1",
      sessionId: "vs_1",
      conversationId: "c_mixed",
      kind: "mix",
      status: "ready",
      partial: true,
      durationMs: 28_900,
      storageKey: "voice/secret-bucket-key.ogg",
    });
    await message("c_mixed", "text_1", at(1));
    await message("c_mixed", "v1_user", at(12), { modality: "voice", voiceSessionId: "vs_1", audioOffsetMs: 1_000 });
    await message("c_mixed", "v1_reply", at(14), {
      role: "assistant",
      modality: "voice",
      voiceSessionId: "vs_1",
      audioOffsetMs: 40_000,
    });
    await message("c_mixed", "text_between", at(50));
    await message("c_mixed", "v2_legacy", at(102), { modality: "voice", voiceSessionId: "vs_2" });

    const review = await getOwnedConversationReview(userId, assistantId, "c_mixed");
    expect(shape(review!.entries)).toEqual([
      { message: "text_1" },
      { call: "vs_1", recording: "rec_1", turns: [["v1_user", 1_000], ["v1_reply", 40_000]] },
      { message: "text_between" },
      { call: "vs_2", recording: null, turns: [["v2_legacy", null]] },
    ]);
    const vs2 = review!.entries[3] as Extract<TimelineEntry, { kind: "call" }>;
    expect(vs2.call.endLabel).toMatch(/Voice minutes used up/);
    // Storage internals never leave the server.
    expect(JSON.stringify(review)).not.toContain("secret-bucket-key");
  });

  it("is owner-only and ignores sessions from other assistants", async () => {
    const mine = await owner();
    const theirs = await owner();
    await conversation(mine.assistantId, "c_owned");
    await session(theirs.assistantId, "vs_foreign", null);
    await message("c_owned", "m_foreign_link", at(1), { modality: "voice", voiceSessionId: "vs_foreign" });

    expect(await getOwnedConversationReview(theirs.userId, mine.assistantId, "c_owned")).toBeNull();
    expect(await getOwnedConversationReview(theirs.userId, theirs.assistantId, "c_owned")).toBeNull();
    expect(await listOwnedConversationReviewItems(theirs.userId, mine.assistantId)).toBeNull();

    const review = await getOwnedConversationReview(mine.userId, mine.assistantId, "c_owned");
    expect(shape(review!.entries)).toEqual([{ message: "m_foreign_link" }]);
  });

  it("dashboard pages 404 for non-owners", async () => {
    const mine = await owner();
    const theirs = await owner();
    await conversation(mine.assistantId, "c_page");
    state.session = { user: { id: theirs.userId } };
    await expect(
      ConversationTranscriptPage({ params: Promise.resolve({ id: mine.assistantId, conversationId: "c_page" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(
      ConversationsPage({ params: Promise.resolve({ id: mine.assistantId }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    state.session = { user: { id: mine.userId } };
    await expect(
      ConversationTranscriptPage({ params: Promise.resolve({ id: mine.assistantId, conversationId: "c_page" }) }),
    ).resolves.toBeTruthy();
  });

  it("list: Text/Voice/Mixed classification; the Voice filter includes Mixed", async () => {
    const { userId, assistantId } = await owner();
    await conversation(assistantId, "l_text", at(1));
    await message("l_text", "lt_1", at(1));
    await conversation(assistantId, "l_voice_turns", at(2));
    await session(assistantId, "lvs_turns", "l_voice_turns");
    await message("l_voice_turns", "lv_1", at(2), { modality: "voice", voiceSessionId: "lvs_turns" });
    await conversation(assistantId, "l_voice_no_transcript", at(3));
    await session(assistantId, "lvs_quiet", "l_voice_no_transcript", { durationMs: 90_000 });
    await conversation(assistantId, "l_mixed", at(4));
    await message("l_mixed", "lm_text", at(4));
    await session(assistantId, "lvs_mixed", "l_mixed");
    await message("l_mixed", "lm_voice", at(5), { modality: "voice", voiceSessionId: "lvs_mixed" });
    await db.insert(voiceRecordings).values({
      id: "lrec",
      sessionId: "lvs_mixed",
      conversationId: "l_mixed",
      kind: "mix",
      status: "ready",
    });
    // No-store sessions are never attached to a conversation; a stray one must not count.
    await conversation(assistantId, "l_text_with_ephemeral", at(6));
    await message("l_text_with_ephemeral", "le_1", at(6));
    await session(assistantId, "lvs_ephemeral", "l_text_with_ephemeral", { ephemeral: true });

    const all = await listOwnedConversationReviewItems(userId, assistantId, "all");
    expect(Object.fromEntries(all!.map((item) => [item.id, item.voice.kind]))).toEqual({
      l_text: "text",
      l_voice_turns: "voice",
      l_voice_no_transcript: "voice",
      l_mixed: "mixed",
      l_text_with_ephemeral: "text",
    });
    const mixed = all!.find((item) => item.id === "l_mixed")!;
    expect(mixed.voice).toMatchObject({ voiceCallCount: 1, recordingCount: 1 });
    expect(all!.find((item) => item.id === "l_voice_no_transcript")!.voice.voiceDurationMs).toBe(90_000);

    const voice = await listOwnedConversationReviewItems(userId, assistantId, "voice");
    expect(voice!.map((item) => item.id).sort()).toEqual(["l_mixed", "l_voice_no_transcript", "l_voice_turns"]);
    const text = await listOwnedConversationReviewItems(userId, assistantId, "text");
    expect(text!.map((item) => item.id).sort()).toEqual(["l_text", "l_text_with_ephemeral"]);
  });

  it("REST list and transcript shapes are unchanged", async () => {
    const { userId, assistantId } = await owner();
    await conversation(assistantId, "r_1");
    await session(assistantId, "rvs", "r_1");
    await message("r_1", "r_voice", at(1), { modality: "voice", voiceSessionId: "rvs", audioOffsetMs: 500 });

    const list = await listOwnedConversations(userId, assistantId);
    expect(list![0]).not.toHaveProperty("voice");
    const transcript = await getOwnedConversationTranscript(userId, assistantId, "r_1");
    expect(transcript!.messages[0]).not.toHaveProperty("audioOffsetMs");
    expect(transcript!.messages[0]).not.toHaveProperty("voiceSessionId");
  });

  it("end to end: durable persist links turns to their call; no-store writes nothing", async () => {
    const { userId, assistantId } = await owner();
    const conversationId = "e2e_conv";
    await conversation(assistantId, conversationId);

    const durable = fakeVoiceRuntime({
      sessionId: "e2e_vs",
      assistantId,
      ephemeral: false,
      conversationId,
      source: "widget",
    });
    await insertDurableVoiceSessionRow(durable);
    await insertVoiceLiveExchange(durable, {
      id: "live_1000",
      startMs: 1_000,
      userText: "Hi there",
      replyText: "Hello!",
      replyStartMs: 1_800,
    });
    await insertVoiceUserMessage(durable, { userText: "What is the Pro plan?", userStartMs: 4_000 } as VoiceTurn);

    const noStore = fakeVoiceRuntime({ sessionId: "e2e_ephemeral", assistantId, ephemeral: true, conversationId });
    await insertOperationalVoiceSessionRow(noStore);
    await insertVoiceLiveExchange(noStore, {
      id: "live_1",
      startMs: 1,
      userText: "never stored",
      replyText: "never stored",
      replyStartMs: 2,
    });
    await insertVoiceUserMessage(noStore, { userText: "never stored", userStartMs: 3 } as VoiceTurn);

    const review = await getOwnedConversationReview(userId, assistantId, conversationId);
    expect(review!.entries).toHaveLength(1);
    const [entry] = review!.entries as Array<Extract<TimelineEntry, { kind: "call" }>>;
    expect(entry!.call.id).toBe("e2e_vs");
    expect(entry!.turns.map((turn) => [turn.role, turn.content, turn.audioOffsetMs])).toEqual([
      ["user", "Hi there", 1_000],
      ["assistant", "Hello!", 1_800],
      ["user", "What is the Pro plan?", 4_000],
    ]);
    expect(JSON.stringify(review)).not.toContain("never stored");
  });
});
