import { pendingLiveExchanges, spokenAnswerText } from "./delegation-orchestrator";
import type {
  VoiceRetrievalTrace,
  VoiceRuntimeSession,
  VoiceSessionCounters,
  VoiceTurnMetrics,
} from "./session-runtime";

export type VoiceDebugTurn = {
  delegationId: string;
  status: string;
  /** Utterance ChatAI assembled from input transcript fragments. */
  userText: string;
  historySupplied: number | null;
  /** Retrieval query produced by prepareAnswer (history-aware rewrite). */
  rewrittenQuery: string | null;
  retrieval: VoiceRetrievalTrace | null;
  groundedAnswer: string | null;
  /** Commentary sent to GPT-Live (speech-formatted grounded answer). */
  answerText: string | null;
  commentary: {
    eventId: string | null;
    acknowledged: boolean;
    ackStartMs: number | null;
    rejectReason: string | null;
  };
  spokenText: string;
  interrupted: boolean;
  supersededBy: string | null;
  lateResultDiscarded: boolean;
  outcome: string | null;
  sources: string[];
  error: string | null;
  metrics: Omit<VoiceTurnMetrics, "delegationReceivedAt">;
};

/**
 * One conversational exchange in spoken order: delegated (answered through
 * ChatAI), live (GPT-Live answered itself) or superseded (user moved on before an
 * answer). `settled` is false for a live exchange that may still grow.
 */
export type VoiceDebugExchange = {
  id: string;
  kind: "delegated" | "live" | "superseded";
  startMs: number;
  question: string;
  answer: string;
  interrupted: boolean;
  settled: boolean;
};

export type VoiceDebugSnapshot = {
  sessionId: string;
  status: string;
  ephemeral: boolean;
  conversationId: string | null;
  usageSeconds: number;
  interruptCount: number;
  historyTurns: number;
  counters: VoiceSessionCounters;
  /** Owner-only sideband health (ids and numbers only). */
  control: {
    state: "attached" | "reattaching" | "lost";
    attempts: number;
    lastGapMs: number | null;
    possibleLoss: boolean;
  };
  turns: VoiceDebugTurn[];
  exchanges: VoiceDebugExchange[];
};

const MAX_DEBUG_TURNS = 20;
const MAX_EXCHANGES = 60;

function voiceExchanges(session: VoiceRuntimeSession): VoiceDebugExchange[] {
  const delegated = session.turns.flatMap((turn): VoiceDebugExchange[] => {
    if (!turn.userText || turn.userStartMs === null) return [];
    if (turn.status === "answered") {
      return [
        {
          id: turn.delegationId,
          kind: "delegated",
          startMs: turn.userStartMs,
          question: turn.userText,
          answer: spokenAnswerText(session, turn) || turn.answerText || "",
          interrupted: turn.interrupted,
          settled: true,
        },
      ];
    }
    if (turn.status === "superseded") {
      return [
        {
          id: turn.delegationId,
          kind: "superseded",
          startMs: turn.userStartMs,
          question: turn.userText,
          answer: "",
          interrupted: false,
          settled: true,
        },
      ];
    }
    return [];
  });
  const live = [
    ...session.liveExchanges.map((exchange) => ({ exchange, settled: true })),
    ...pendingLiveExchanges(session).map((exchange) => ({ exchange, settled: false })),
  ].map(({ exchange, settled }): VoiceDebugExchange => ({
    id: exchange.id,
    kind: "live",
    startMs: exchange.startMs,
    question: exchange.userText,
    answer: exchange.replyText,
    interrupted: false,
    settled,
  }));
  return [...delegated, ...live].sort((a, b) => a.startMs - b.startMs).slice(-MAX_EXCHANGES);
}

/**
 * Owner-only playground view of the in-memory runtime. Never persisted; for no-store
 * sessions it mirrors content the owner's browser already receives on the data channel.
 */
export function serializeVoiceDebug(session: VoiceRuntimeSession): VoiceDebugSnapshot {
  return {
    sessionId: session.sessionId,
    status: session.status,
    ephemeral: session.ephemeral,
    conversationId: session.conversationId,
    usageSeconds: session.usageSeconds,
    interruptCount: session.interruptCount,
    historyTurns: session.history.length,
    counters: { ...session.counters },
    control: {
      state: session.control?.state ?? "attached",
      attempts: session.control?.attempts ?? 0,
      lastGapMs: session.control?.lastGapMs ?? null,
      possibleLoss: session.control?.possibleLoss ?? false,
    },
    turns: session.turns.slice(-MAX_DEBUG_TURNS).map((turn) => {
      const metrics = {
        utteranceReadyMs: turn.metrics.utteranceReadyMs,
        ragStartMs: turn.metrics.ragStartMs,
        ragDurationMs: turn.metrics.ragDurationMs,
        generateDurationMs: turn.metrics.generateDurationMs,
        firstCommentaryMs: turn.metrics.firstCommentaryMs,
        commentaryAckMs: turn.metrics.commentaryAckMs,
        firstSpeechMs: turn.metrics.firstSpeechMs,
        bargeInHoldMs: turn.metrics.bargeInHoldMs,
      };
      return {
        delegationId: turn.delegationId,
        status: turn.status,
        userText: turn.userText,
        historySupplied: turn.historySupplied,
        rewrittenQuery: turn.rewrittenQuery,
        retrieval: turn.retrieval,
        groundedAnswer: turn.groundedAnswer,
        answerText: turn.answerText,
        commentary: {
          eventId: turn.commentaryEventId,
          acknowledged: turn.metrics.commentaryAckMs !== undefined,
          ackStartMs: turn.commentaryAckStartMs,
          rejectReason: turn.rejectReason,
        },
        spokenText: spokenAnswerText(session, turn),
        interrupted: turn.interrupted,
        supersededBy: turn.supersededBy,
        lateResultDiscarded: turn.lateResultDiscarded,
        outcome: turn.outcome,
        sources: turn.sources.map((source) => source.documentName),
        error: turn.error,
        metrics,
      };
    }),
    exchanges: voiceExchanges(session),
  };
}
