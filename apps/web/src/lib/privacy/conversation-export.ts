import type { MessageSource } from "@chatai/database";

import type { TranscriptMessage } from "@/lib/conversation-list";

/** Allowlisted soak fields — never full retrieval dumps or provider secrets. */
export type ConversationExportDebug = {
  answerOwner?: string;
  shadowAgent?: boolean;
  /** Last rewritten retrieval query (agent path) or planner query (legacy). */
  question?: string;
  /** Slim search rewrite pairs — strings only, never passage bodies. */
  searchQueries?: Array<{ raw: string; rewritten: string }>;
  timings?: {
    t_agent_draft_ms?: number;
    t_verify_ms?: number;
    t_purpose_ms?: number;
    t_validated_ready_ms?: number;
  };
  voice?: {
    answeredBy?: string;
    welcome?: boolean;
    delegationId?: string;
  };
};

/**
 * Explicit conversation export shape — never a raw DB row dump.
 * Excludes secrets and raw retrieval / prompt internals.
 */
export type ConversationExportJson = {
  exportedAt: string;
  conversation: {
    id: string;
    assistantId: string;
    source: string;
    visitorId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    sources: MessageSource[];
    outcome: string | null;
    feedback: string | null;
    confidence: number | null;
    modality: "text" | "voice";
    wasInterrupted: boolean;
    debug?: ConversationExportDebug;
    createdAt: string;
  }>;
};

const TIMING_KEYS = [
  "t_agent_draft_ms",
  "t_verify_ms",
  "t_purpose_ms",
  "t_validated_ready_ms",
] as const;

/** Strip message debug down to soak-safe fields. */
export function sanitizeExportDebug(raw: unknown): ConversationExportDebug | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const out: ConversationExportDebug = {};

  if (typeof source.answerOwner === "string") out.answerOwner = source.answerOwner;
  if (typeof source.shadowAgent === "boolean") out.shadowAgent = source.shadowAgent;
  if (typeof source.question === "string" && source.question.trim()) {
    out.question = source.question.trim().slice(0, 400);
  }
  if (Array.isArray(source.searchQueries)) {
    const searchQueries: NonNullable<ConversationExportDebug["searchQueries"]> = [];
    for (const entry of source.searchQueries.slice(0, 8)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const raw = typeof (entry as { raw?: unknown }).raw === "string" ? (entry as { raw: string }).raw.trim() : "";
      const rewritten =
        typeof (entry as { rewritten?: unknown }).rewritten === "string"
          ? (entry as { rewritten: string }).rewritten.trim()
          : "";
      if (!raw && !rewritten) continue;
      searchQueries.push({
        raw: raw.slice(0, 400),
        rewritten: rewritten.slice(0, 400),
      });
    }
    if (searchQueries.length > 0) out.searchQueries = searchQueries;
  }

  if (source.timings && typeof source.timings === "object" && !Array.isArray(source.timings)) {
    const timingsIn = source.timings as Record<string, unknown>;
    const timings: NonNullable<ConversationExportDebug["timings"]> = {};
    for (const key of TIMING_KEYS) {
      if (typeof timingsIn[key] === "number") timings[key] = timingsIn[key];
    }
    if (Object.keys(timings).length > 0) out.timings = timings;
  }

  if (source.voice && typeof source.voice === "object" && !Array.isArray(source.voice)) {
    const voiceIn = source.voice as Record<string, unknown>;
    const voice: NonNullable<ConversationExportDebug["voice"]> = {};
    if (typeof voiceIn.answeredBy === "string") voice.answeredBy = voiceIn.answeredBy;
    if (voiceIn.welcome === true) voice.welcome = true;
    if (typeof voiceIn.delegationId === "string") voice.delegationId = voiceIn.delegationId;
    if (Object.keys(voice).length > 0) out.voice = voice;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildConversationExport(input: {
  assistantId: string;
  conversation: {
    id: string;
    source: string;
    visitorId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  messages: TranscriptMessage[];
  now?: Date;
}): ConversationExportJson {
  return {
    exportedAt: (input.now ?? new Date()).toISOString(),
    conversation: {
      id: input.conversation.id,
      assistantId: input.assistantId,
      source: input.conversation.source,
      visitorId: input.conversation.visitorId,
      createdAt: input.conversation.createdAt.toISOString(),
      updatedAt: input.conversation.updatedAt.toISOString(),
    },
    messages: input.messages.map((message) => {
      const debug = sanitizeExportDebug(message.debug);
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        sources: message.sources ?? [],
        outcome: message.outcome ?? null,
        feedback: message.feedback ?? null,
        confidence: message.confidence ?? null,
        modality: message.modality ?? "text",
        wasInterrupted: message.wasInterrupted ?? false,
        ...(debug ? { debug } : {}),
        createdAt: message.createdAt.toISOString(),
      };
    }),
  };
}
