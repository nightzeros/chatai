import type {
  ConversationSource,
  MessageOutcome,
  MessageSource,
  VoiceMeteringStatus,
} from "@chatai/database";

import { sanitizeAudioOffsetMs } from "@/lib/voice/audio-offset";
import { formatVoiceDuration } from "@/lib/voice/duration-format";
import type { VoiceRecordingView } from "@/lib/voice/recording/playback";

/** A stored message as loaded for the owner review page. */
export type ReviewMessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources: MessageSource[] | null;
  outcome: MessageOutcome | null;
  feedback: "positive" | "negative" | null;
  confidence: number | null;
  modality: "text" | "voice";
  wasInterrupted: boolean;
  /** Authoritative call membership (messages.voice_session_id). */
  voiceSessionId: string | null;
  audioOffsetMs: number | null;
  latencyMs: number | null;
  debug: unknown;
  createdAt: Date;
};

export type VoiceCallRecord = {
  id: string;
  source: ConversationSource;
  status: "connecting" | "connected" | "ended" | "failed";
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  interruptCount: number;
  voiceSeconds: number | null;
  meteringStatus: VoiceMeteringStatus;
  quotaExempt: boolean;
};

export type VoiceRecordingRecord = VoiceRecordingView & { sessionId: string };

/** Owner-facing summary of `messages.debug.voice`; raw debug never reaches the UI. */
export type VoiceTurnDetails = {
  answeredBy: "knowledge" | "voice_model" | null;
  /** Knowledge search query, when it differs from what the visitor said. */
  searchQuery: string | null;
  /** Documents the knowledge search matched (deduplicated, capped). */
  matchedDocuments: string[];
  /** Delegation received → answer handed to the Voice model. */
  answerReadyMs: number | null;
  /** Knowledge search duration. */
  lookupMs: number | null;
  interrupted: boolean;
};

export type TimelineMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: MessageSource[];
  outcome: MessageOutcome | null;
  feedback: "positive" | "negative" | null;
  modality: "text" | "voice";
  wasInterrupted: boolean;
  createdAt: string;
  /** Position in the call recording; only set for turns that belong to a call. */
  audioOffsetMs: number | null;
  voiceDetails: VoiceTurnDetails | null;
};

export type VoiceCallTone = "default" | "warning" | "error";

export type VoiceCallView = {
  id: string;
  sourceLabel: string;
  startedAt: string;
  durationMs: number | null;
  inProgress: boolean;
  endLabel: string;
  endTone: VoiceCallTone;
  /** Customer Voice time (never provider cost). */
  usageLabel: string | null;
  interruptCount: number;
};

export type TimelineEntry =
  | { kind: "message"; at: string; message: TimelineMessage }
  | {
      kind: "call";
      at: string;
      call: VoiceCallView;
      recording: VoiceRecordingView | null;
      turns: TimelineMessage[];
    };

const MAX_MATCHED_DOCUMENTS = 5;
const MAX_QUERY_CHARS = 300;

const CALL_SOURCE_LABEL: Record<ConversationSource, string> = {
  playground: "Playground",
  widget: "Widget",
  api: "API",
};

const END_LABELS: Record<string, { label: string; tone: VoiceCallTone }> = {
  usage_limit: { label: "Ended: Voice minutes used up", tone: "warning" },
  superseded: { label: "Ended: replaced by a newer call from the same visitor", tone: "default" },
  runtime_ttl_expired: { label: "Ended: reached the maximum call length", tone: "warning" },
  runtime_lost: { label: "Ended: the server stopped during the call", tone: "error" },
  shutdown: { label: "Ended: the server shut down or restarted (graceful)", tone: "default" },
  sideband_disconnected: { label: "Ended: connection to the Voice provider was lost", tone: "error" },
  usage_unconfirmed: { label: "Ended: the Voice provider did not confirm the end", tone: "warning" },
  mint_failed: { label: "Call failed to start", tone: "error" },
  assistant_deleted: { label: "Ended: assistant deleted", tone: "default" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function durationValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function voiceCallEnd(call: Pick<VoiceCallRecord, "status" | "errorCode">): {
  inProgress: boolean;
  label: string;
  tone: VoiceCallTone;
} {
  if (call.status === "connecting" || call.status === "connected") {
    return { inProgress: true, label: "In progress", tone: "default" };
  }
  const known = call.errorCode ? END_LABELS[call.errorCode] : undefined;
  if (known) return { inProgress: false, ...known };
  if (call.status === "failed") return { inProgress: false, label: "Ended with an error", tone: "error" };
  return { inProgress: false, label: "Ended", tone: "default" };
}

export function voiceCallUsageLabel(
  call: Pick<VoiceCallRecord, "quotaExempt" | "meteringStatus" | "voiceSeconds">,
): string | null {
  if (call.quotaExempt) return "Playground call: not counted toward Voice minutes";
  switch (call.meteringStatus) {
    case "settled":
      return call.voiceSeconds !== null ? `${formatVoiceDuration(call.voiceSeconds)} of Voice time` : null;
    case "estimated":
      return call.voiceSeconds !== null
        ? `${formatVoiceDuration(call.voiceSeconds)} of Voice time (estimated)`
        : null;
    case "not_billable":
      return "Not counted: the call never connected";
    default:
      return null;
  }
}

export function voiceTurnDetails(
  row: Pick<ReviewMessageRecord, "role" | "modality" | "debug" | "wasInterrupted">,
  previousUserText: string | null,
): VoiceTurnDetails | null {
  if (row.role !== "assistant" || row.modality !== "voice") return null;
  const debug = isRecord(row.debug) ? row.debug : null;
  const voice = debug && isRecord(debug.voice) ? debug.voice : null;
  const answeredBy =
    voice && (voice.delegated === false || voice.answeredBy === "realtime_model")
      ? "voice_model"
      : voice && typeof voice.delegationId === "string"
        ? "knowledge"
        : null;

  let searchQuery: string | null = null;
  if (answeredBy === "knowledge" && typeof voice?.rewrittenQuery === "string") {
    const query = voice.rewrittenQuery.trim().slice(0, MAX_QUERY_CHARS);
    if (query && (!previousUserText || normalized(query) !== normalized(previousUserText))) {
      searchQuery = query;
    }
  }

  const matchedDocuments =
    answeredBy === "knowledge" && Array.isArray(debug?.retrieval)
      ? [
          ...new Set(
            debug.retrieval.flatMap((item) =>
              isRecord(item) && typeof item.documentName === "string" && item.documentName.trim()
                ? [item.documentName.trim()]
                : [],
            ),
          ),
        ].slice(0, MAX_MATCHED_DOCUMENTS)
      : [];

  const metrics = voice && isRecord(voice.metrics) ? voice.metrics : null;
  return {
    answeredBy,
    searchQuery,
    matchedDocuments,
    answerReadyMs: durationValue(metrics?.firstCommentaryMs),
    lookupMs: durationValue(metrics?.ragDurationMs),
    interrupted: row.wasInterrupted,
  };
}

/** A Voice answer shows what GPT-Live spoke; `content` keeps the backend answer. */
function displayContent(row: Pick<ReviewMessageRecord, "role" | "modality" | "debug" | "content">): string {
  if (row.role !== "assistant" || row.modality !== "voice") return row.content;
  const voice = isRecord(row.debug) && isRecord(row.debug.voice) ? row.debug.voice : null;
  const spoken = typeof voice?.spokenText === "string" ? voice.spokenText.trim() : "";
  return spoken || row.content;
}

const RECORDING_PRIORITY: Record<VoiceRecordingView["status"], number> = {
  ready: 0,
  pending: 1,
  failed: 2,
  expired: 3,
};

/** One recording per call: a playable one first, then the most recent. */
function primaryRecordings(recordings: VoiceRecordingRecord[]): Map<string, VoiceRecordingView> {
  const bySession = new Map<string, VoiceRecordingRecord>();
  for (const recording of recordings) {
    const current = bySession.get(recording.sessionId);
    if (
      !current ||
      RECORDING_PRIORITY[recording.status] < RECORDING_PRIORITY[current.status] ||
      (RECORDING_PRIORITY[recording.status] === RECORDING_PRIORITY[current.status] &&
        recording.createdAt > current.createdAt)
    ) {
      bySession.set(recording.sessionId, recording);
    }
  }
  return new Map(
    [...bySession].map(([sessionId, recording]) => [
      sessionId,
      {
        id: recording.id,
        status: recording.status,
        partial: recording.partial,
        durationMs: recording.durationMs,
        createdAt: recording.createdAt,
        expiresAt: recording.expiresAt,
        deletedAt: recording.deletedAt,
        timelineVersion: recording.timelineVersion,
      },
    ]),
  );
}

/**
 * Orders a conversation for owner review: text turns and Voice calls interleaved
 * by time, with each Voice turn nested under the call it belongs to.
 *
 * Call membership comes only from `voiceSessionId`; timestamps are used for
 * ordering, never to guess which call a turn belongs to. A Voice turn without a
 * known call is shown on its own, without playback.
 */
export function buildConversationTimeline(input: {
  messages: ReviewMessageRecord[];
  calls: VoiceCallRecord[];
  recordings: VoiceRecordingRecord[];
}): TimelineEntry[] {
  const callsById = new Map(input.calls.map((call) => [call.id, call]));
  const recordingBySession = primaryRecordings(input.recordings);
  const turnsByCall = new Map<string, TimelineMessage[]>();
  const loose: TimelineMessage[] = [];

  const ordered = input.messages
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.index - b.index);

  let previousUserText: string | null = null;
  for (const { row } of ordered) {
    if (row.role === "system") continue;
    const call =
      row.modality === "voice" && row.voiceSessionId ? callsById.get(row.voiceSessionId) : undefined;
    const message: TimelineMessage = {
      id: row.id,
      role: row.role,
      content: displayContent(row),
      sources: row.sources ?? [],
      outcome: row.outcome ?? null,
      feedback: row.feedback ?? null,
      modality: row.modality,
      wasInterrupted: row.wasInterrupted,
      createdAt: row.createdAt.toISOString(),
      audioOffsetMs: call ? sanitizeAudioOffsetMs(row.audioOffsetMs) : null,
      voiceDetails: voiceTurnDetails(row, previousUserText),
    };
    if (row.role === "user") previousUserText = row.content;
    if (call) {
      const turns = turnsByCall.get(call.id) ?? [];
      turns.push(message);
      turnsByCall.set(call.id, turns);
    } else {
      loose.push(message);
    }
  }

  const entries: TimelineEntry[] = [
    ...loose.map((message): TimelineEntry => ({ kind: "message", at: message.createdAt, message })),
    ...input.calls.map((call): TimelineEntry => {
      const end = voiceCallEnd(call);
      return {
        kind: "call",
        at: call.startedAt.toISOString(),
        call: {
          id: call.id,
          sourceLabel: CALL_SOURCE_LABEL[call.source],
          startedAt: call.startedAt.toISOString(),
          durationMs: durationValue(call.durationMs),
          inProgress: end.inProgress,
          endLabel: end.label,
          endTone: end.tone,
          usageLabel: voiceCallUsageLabel(call),
          interruptCount: call.interruptCount,
        },
        recording: recordingBySession.get(call.id) ?? null,
        turns: turnsByCall.get(call.id) ?? [],
      };
    }),
  ];

  // Calls sort ahead of a message with the same timestamp (the call started first).
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Date.parse(a.entry.at) - Date.parse(b.entry.at) ||
        (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "call" ? -1 : 1) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
}
