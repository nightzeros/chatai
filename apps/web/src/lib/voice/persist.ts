import {
  conversations,
  eq,
  messages,
  voiceEvents,
  voiceSessions,
  type MessageDebug,
} from "@chatai/database";

import { loadRecentConversationHistory } from "@/lib/conversation-history";
import { db } from "@/lib/db";
import { createId } from "@/lib/ids";
import { sanitizeAudioOffsetMs } from "./audio-offset";
import { voiceTurnOffsetMs } from "./turn-offsets";
import type {
  VoiceHistoryTurn,
  VoiceLiveExchange,
  VoiceRuntimeSession,
  VoiceTurn,
} from "./session-runtime";

/**
 * Persist rules:
 * - Durable (storeConversations): voice_sessions metadata + lifecycle events without
 *   transcript/audio payloads; voice turns become messages (modality=voice) only when
 *   saveTranscripts is also on.
 * - No-store: do NOT insert conversational content. Minimal operational row
 *   (ephemeral=true) for later billing/abuse — no voice_events, no messages.
 */

/** Single gate for any durable conversational write from a voice session. */
export function canPersistVoiceContent(session: VoiceRuntimeSession): boolean {
  return (
    !session.ephemeral &&
    session.persistence.storeConversations &&
    session.persistence.saveTranscripts &&
    Boolean(session.conversationId)
  );
}

const CONTENT_KEYS = [
  "transcript",
  "inputTranscript",
  "outputTranscript",
  "audio",
  "content",
  "text",
  "userText",
  "answerText",
  "spokenText",
  "query",
] as const;

export async function createVoiceConversation(input: {
  assistantId: string;
  visitorId: string | null;
  source: VoiceRuntimeSession["source"];
}): Promise<string> {
  const id = createId();
  await db().insert(conversations).values({
    id,
    assistantId: input.assistantId,
    visitorId: input.visitorId,
    source: input.source,
  });
  return id;
}

const lastVoiceRowAt = new WeakMap<VoiceRuntimeSession, number>();

/**
 * Strictly increasing app-clock timestamp per session, taken synchronously when a
 * write is issued, so rows keep spoken order even when issued in the same millisecond.
 */
function nextVoiceRowAt(session: VoiceRuntimeSession): Date {
  const at = Math.max(Date.now(), (lastVoiceRowAt.get(session) ?? 0) + 1);
  lastVoiceRowAt.set(session, at);
  return new Date(at);
}

/** Text→voice continuity uses the same history semantics as text chat. */
export async function loadConversationHistory(conversationId: string): Promise<VoiceHistoryTurn[]> {
  return loadRecentConversationHistory(conversationId);
}

export async function insertVoiceUserMessage(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
): Promise<void> {
  if (!canPersistVoiceContent(session) || !turn.userText) return;
  const id = createId();
  await db().insert(messages).values({
    id,
    conversationId: session.conversationId!,
    role: "user",
    content: turn.userText,
    modality: "voice",
    voiceSessionId: session.durableRowInserted ? session.sessionId : null,
    audioOffsetMs: voiceTurnOffsetMs(session, "user", turn.userStartMs),
    createdAt: nextVoiceRowAt(session),
  });
  turn.userMessageId = id;
}

/**
 * A turn GPT-Live answered itself; stored like any other voice turn, without RAG
 * metadata. Only the reply the visitor heard becomes an assistant message; a reply
 * the playback gate withheld is kept as owner-only debug, never as conversation.
 */
export async function insertVoiceLiveExchange(
  session: VoiceRuntimeSession,
  exchange: VoiceLiveExchange,
): Promise<void> {
  if (!canPersistVoiceContent(session) || !exchange.userText) return;
  const voiceSessionId = session.durableRowInserted ? session.sessionId : null;
  const userAt = nextVoiceRowAt(session);
  const replyAt = exchange.replyText ? nextVoiceRowAt(session) : null;
  const withheld = exchange.withheldText ? { withheldText: exchange.withheldText } : null;
  await db().insert(messages).values({
    id: createId(),
    conversationId: session.conversationId!,
    role: "user",
    content: exchange.userText,
    ...(withheld && !exchange.replyText ? { debug: { voice: withheld } } : {}),
    modality: "voice",
    voiceSessionId,
    audioOffsetMs: voiceTurnOffsetMs(session, "user", exchange.startMs),
    createdAt: userAt,
  });
  if (!exchange.replyText || !replyAt) return;
  await db().insert(messages).values({
    id: createId(),
    conversationId: session.conversationId!,
    role: "assistant",
    content: exchange.replyText,
    sources: [],
    outcome: null,
    debug: { voice: { delegated: false, answeredBy: "realtime_model", ...withheld } },
    modality: "voice",
    voiceSessionId,
    audioOffsetMs: voiceTurnOffsetMs(session, "assistant", exchange.replyStartMs),
    createdAt: replyAt,
  });
  await db()
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, session.conversationId!));
}

/** Debug written with each delegated answer, so the spoken update merges instead of replacing it. */
const insertedDebug = new WeakMap<VoiceTurn, MessageDebug>();

export async function insertVoiceAssistantMessage(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  debug: MessageDebug,
): Promise<void> {
  if (!canPersistVoiceContent(session) || !turn.answerText) return;
  const id = createId();
  insertedDebug.set(turn, debug);
  await db().insert(messages).values({
    id,
    conversationId: session.conversationId!,
    role: "assistant",
    content: turn.answerText,
    sources: turn.sources,
    confidence: turn.confidence,
    outcome: turn.outcome,
    debug,
    latencyMs: turn.metrics.firstCommentaryMs ?? null,
    modality: "voice",
    voiceSessionId: session.durableRowInserted ? session.sessionId : null,
    createdAt: nextVoiceRowAt(session),
  });
  turn.assistantMessageId = id;
  await db()
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, session.conversationId!));
}

/**
 * Record what GPT-Live actually spoke, mark barge-in, and record where the spoken
 * answer starts on the call timeline. `content` stays the backend answer: grounded
 * history must never carry text the backend did not produce, so the spoken
 * rendering lives beside it in debug for Conversation Review.
 */
export async function updateVoiceAssistantMessageSpoken(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  spokenStartMs: number | null = null,
): Promise<void> {
  if (!canPersistVoiceContent(session) || !turn.assistantMessageId) return;
  const spoken = turn.spokenText.trim();
  if (!spoken && !turn.interrupted) return;
  const audioOffsetMs = voiceTurnOffsetMs(session, "assistant", spokenStartMs);
  const debug = insertedDebug.get(turn);
  await db()
    .update(messages)
    .set({
      ...(spoken && debug ? { debug: withSpokenText(debug, spoken) } : {}),
      wasInterrupted: turn.interrupted,
      ...(audioOffsetMs !== null ? { audioOffsetMs } : {}),
    })
    .where(eq(messages.id, turn.assistantMessageId));
}

function withSpokenText(debug: MessageDebug, spokenText: string): MessageDebug {
  const voice = debug.voice && typeof debug.voice === "object" ? debug.voice : {};
  return { ...debug, voice: { ...voice, spokenText } };
}

export async function insertDurableVoiceSessionRow(
  session: VoiceRuntimeSession,
): Promise<void> {
  if (session.durableRowInserted) return;

  const values = {
    conversationId: session.ephemeral ? null : session.conversationId,
    providerSessionId: session.providerSessionId,
    ephemeral: session.ephemeral,
    model: session.model,
    voiceId: session.voiceId,
    startedAt: session.startedAt,
    recordingConsentAt: session.recordingConsentAt,
  };
  // Mint admission already created the metering row; this fills in session metadata.
  await db()
    .insert(voiceSessions)
    .values({
      id: session.sessionId,
      assistantId: session.assistantId,
      visitorId: session.visitorId,
      source: session.source,
      provider: session.providerId,
      status: "connecting",
      interruptCount: 0,
      ...values,
    })
    .onConflictDoUpdate({ target: voiceSessions.id, set: { ...values, updatedAt: new Date() } });
  session.durableRowInserted = true;
}

/**
 * No-store operational metadata only — no transcripts, audio refs, or RAG content.
 * Used so hosted billing can later attach billableSeconds without retaining conversation.
 */
export async function insertOperationalVoiceSessionRow(
  session: VoiceRuntimeSession,
): Promise<void> {
  if (!session.ephemeral) {
    await insertDurableVoiceSessionRow(session);
    return;
  }
  if (session.durableRowInserted) return;

  const values = {
    conversationId: null,
    providerSessionId: session.providerSessionId,
    ephemeral: true,
    model: session.model,
    voiceId: session.voiceId,
    startedAt: session.startedAt,
  };
  await db()
    .insert(voiceSessions)
    .values({
      id: session.sessionId,
      assistantId: session.assistantId,
      visitorId: session.visitorId,
      source: session.source,
      provider: session.providerId,
      status: "connecting",
      interruptCount: 0,
      ...values,
    })
    .onConflictDoUpdate({ target: voiceSessions.id, set: { ...values, updatedAt: new Date() } });
  session.durableRowInserted = true;
}

export async function markVoiceSessionConnected(session: VoiceRuntimeSession): Promise<void> {
  if (!session.durableRowInserted) return;
  await db()
    .update(voiceSessions)
    .set({ status: "connected", updatedAt: new Date() })
    .where(eq(voiceSessions.id, session.sessionId));
}

export async function writeLifecycleVoiceEvent(
  session: VoiceRuntimeSession,
  type:
    | "session.started"
    | "session.ended"
    | "rag.started"
    | "rag.completed"
    | "assistant.interrupted"
    | "session.reconnecting"
    | "error",
  payload: Record<string, unknown> = {},
): Promise<void> {
  // Never write lifecycle events for no-store — avoids any conversational adjacency
  // and keeps Postgres free of session narrative for ephemeral calls.
  if (session.ephemeral || !session.durableRowInserted) return;

  // Strip any accidental transcript-like keys.
  const safePayload = { ...payload };
  for (const key of CONTENT_KEYS) delete safePayload[key];

  await db().insert(voiceEvents).values({
    id: createId(),
    sessionId: session.sessionId,
    type,
    offsetMs: sanitizeAudioOffsetMs(Date.now() - session.startedAt.getTime()),
    payload: safePayload,
  });
}

export async function finalizeVoiceSessionRow(
  session: VoiceRuntimeSession,
  input: {
    status: "ended" | "failed";
    billableSeconds: number | null;
    usageFinalized: boolean;
    errorCode?: string | null;
  },
): Promise<void> {
  if (!session.durableRowInserted) return;

  const endedAt = session.endedAt ?? new Date();
  const durationMs = Math.max(0, endedAt.getTime() - session.startedAt.getTime());

  await db()
    .update(voiceSessions)
    .set({
      status: input.status,
      endedAt,
      durationMs,
      billableSeconds: input.billableSeconds,
      interruptCount: session.interruptCount,
      errorCode: input.errorCode ?? session.errorCode,
      updatedAt: new Date(),
      // providerSessionId retained for operational correlation only — not a credential.
    })
    .where(eq(voiceSessions.id, session.sessionId));

  if (!session.ephemeral) {
    await writeLifecycleVoiceEvent(session, "session.ended", {
      usageFinalized: input.usageFinalized,
      billableSeconds: input.billableSeconds,
    });
  }
}

export async function markVoiceSessionFailed(
  session: VoiceRuntimeSession,
  errorCode: string,
): Promise<void> {
  session.status = "failed";
  session.errorCode = errorCode;
  session.endedAt = new Date();
  if (!session.durableRowInserted) return;
  await db()
    .update(voiceSessions)
    .set({
      status: "failed",
      endedAt: session.endedAt,
      errorCode,
      updatedAt: new Date(),
    })
    .where(eq(voiceSessions.id, session.sessionId));
}
