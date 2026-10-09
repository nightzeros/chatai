import type {
  assistants,
  ConversationSource,
  EffectiveVoicePersistence,
  MessageOutcome,
  MessageSource,
  ModelSettings,
  RagSettings,
  ResolvedVoiceSettings,
} from "@chatai/database";
import type {
  AppendRejectReason,
  RealtimeVoiceProvider,
  VoiceControlChannel,
  VoiceControlEvent,
} from "@chatai/voice";
import { DelegationTracker } from "@chatai/voice";
import type { ChatHistoryMessage } from "@chatai/rag/answer";

import type { HostingAccount } from "@/lib/hosting/accounts";

import { voiceNow } from "./clock";

export type VoiceRuntimeStatus =
  | "connecting"
  | "connected"
  | "ending"
  | "ended"
  | "failed";

/** Same semantics as text-chat history (see lib/conversation-history). */
export type VoiceHistoryTurn = ChatHistoryMessage;

export type TranscriptFragment = {
  text: string;
  startMs: number;
  endMs: number;
  /** Output spoken while the playback gate was closed: the visitor never heard it. */
  withheld?: boolean;
};

/**
 * A user utterance GPT-Live answered itself (no delegation). It is part of the
 * conversation like any other turn; content stays in memory unless durable
 * transcripts are on.
 */
export type VoiceLiveExchange = {
  /** Deterministic from the utterance start so previews and settled entries match. */
  id: string;
  startMs: number;
  userText: string;
  /** What the visitor heard (approved by the playback gate). */
  replyText: string;
  /** Provider timeline start of the reply; null when GPT-Live did not answer. */
  replyStartMs: number | null;
  /** Live reply the playback gate withheld; never history, never shown as heard. */
  withheldText?: string;
};

export type VoiceTurnStatus =
  | "collecting"
  | "retrieving"
  | "generating"
  | "answered"
  | "superseded"
  | "failed";

/** Wall-clock deltas (ms) measured from `delegation.created` receipt. */
export type VoiceTurnMetrics = {
  delegationReceivedAt: number;
  utteranceReadyMs?: number;
  ragStartMs?: number;
  ragDurationMs?: number;
  generateDurationMs?: number;
  firstCommentaryMs?: number;
  commentaryAckMs?: number;
  /** First assistant output transcript after commentary — server-side TTFA proxy. */
  firstSpeechMs?: number;
  /** Time the ready answer was held while post-delegation user speech was unresolved. */
  bargeInHoldMs?: number;
  /** Shared ChatAI scope decision for this delegation. */
  scopeDecision?: "in" | "partial" | "out" | "unknown";
  /** Scope classifier call duration. */
  plannerMs?: number;
  /** Time the answer waited on the classifier beyond retrieval. */
  plannerWaitMs?: number;
  /** Assistant Profile version used for this turn. */
  profileVersion?: number;
  /** GPT-Live engaged with the request before the backend reply (audit only). */
  preScopeEngagement?: boolean;
  /** The output scope check replaced this turn's answer. */
  outputGuardReplaced?: boolean;
};

/**
 * One backend turn handled by ChatAI: a client delegation, or a turn the server
 * forced because GPT-Live did not delegate a non-social utterance. Content fields
 * live in memory only; no-store sessions never write them to Postgres.
 */
export type VoiceTurn = {
  /** Stable id: the delegation id, or a server id for forced turns. */
  id: string;
  origin: "delegation" | "server";
  /** Null for a server-forced turn until GPT-Live delegates the same utterance. */
  delegationId: string | null;
  offsetMs: number;
  status: VoiceTurnStatus;
  userText: string;
  /** Provider timeline start of the user's utterance (orders turns with live exchanges). */
  userStartMs: number | null;
  rewrittenQuery: string | null;
  answerText: string | null;
  spokenText: string;
  interrupted: boolean;
  supersededBy: "new_delegation" | "barge_in" | "session_closed" | "control_lost" | null;
  lateResultDiscarded: boolean;
  rejectReason: AppendRejectReason | null;
  outcome: MessageOutcome | null;
  sources: MessageSource[];
  confidence: number | null;
  error: string | null;
  metrics: VoiceTurnMetrics;
  /** Prior turns passed to prepareAnswer for query rewriting. */
  historySupplied: number | null;
  /** Owner-debug trace of the shared RAG pipeline for this turn; never sent to visitors. */
  retrieval: VoiceRetrievalTrace | null;
  /** `finalizeAnswer` output before speech formatting. */
  groundedAnswer: string | null;
  commentaryEventId: string | null;
  /** Provider audio-timeline position where the commentary was inserted (from its ack). */
  commentaryAckStartMs: number | null;
  /** outputFragments index when commentary was sent; later fragments are this turn's speech. */
  outputIndexAtCommentary: number | null;
  /** outputFragments index when the next turn started (end of this turn's speech). */
  outputIndexEnd: number | null;
  finalized: boolean;
  userMessageId: string | null;
  assistantMessageId: string | null;
  bargeInText: string;
  /** Wall clock of the latest post-offset user fragment (barge-in candidate). */
  bargeInAt: number | null;
  /** Live speech the playback gate withheld before this turn's answer (owner review only). */
  withheldText: string;
  abort: AbortController;
};

export type VoiceRetrievalTrace = {
  action: "generate" | "fallback";
  contextSufficient: boolean;
  chunks: Array<{ documentName: string; similarity: number; preview: string }>;
};

export type VoiceSessionCounters = {
  delegations: number;
  answered: number;
  superseded: number;
  bargeIns: number;
  lateResultsDiscarded: number;
  appendRejected: number;
  ragFailures: number;
  providerErrors: number;
  delegationTimeouts: number;
  controlDisconnects: number;
  controlRecoveries: number;
};

/**
 * Trusted-sideband health. `reattaching` is bounded; `lost` always ends the call.
 * Only ids and numbers: never conversational content.
 */
export type VoiceControlState = {
  state: "attached" | "reattaching" | "lost";
  lostAt: number | null;
  attempts: number;
  lastGapMs: number | null;
  /** The last gap outlived the provider's replay backlog: events may be missing. */
  possibleLoss: boolean;
  /**
   * In-flight turns aborted by the loss; each gets a fallback on recovery (null:
   * a server-forced turn, answered with session-wide commentary).
   */
  interruptedDelegations: Array<string | null>;
};

/** Server-side supervision clocks (idle, heartbeat, max-duration warning). */
export type VoiceSupervisionState = {
  /** Idle reference: last visitor speech, or the end of a pause (lookup, re-attach). */
  idleSince: number;
  idleWarnedAt: number | null;
  maxDurationWarned: boolean;
  /** Client declared `heartbeat` at mint and received a control token. */
  heartbeatCapable: boolean;
  lastHeartbeatAt: number;
  timer: ReturnType<typeof setInterval> | null;
};

/** Assistant snapshot captured at mint so delegations do not re-query config. */
export type VoiceAssistantContext = {
  id: string;
  /** Describes the assistant in scope redirects (same input as Text). */
  name?: string | null;
  /** Owner-written description (domain statement when no Purpose or Instructions exist). */
  description?: string | null;
  instructions: string | null;
  hallucinationMode: (typeof assistants.$inferSelect)["hallucinationMode"];
  ragSettings: RagSettings | null;
  modelSettings: ModelSettings | null;
  hostingAccount: HostingAccount;
};

/**
 * In-memory / TTL runtime for an active voice session.
 * Holds transcript buffers, history and delegation state for the live call only.
 * No-store sessions must never promote conversational buffers into Postgres.
 */
export type VoiceRuntimeSession = {
  sessionId: string;
  providerSessionId: string;
  assistantId: string;
  assistantPublicId: string;
  visitorId: string | null;
  source: ConversationSource;
  conversationId: string | null;
  /** True when global no-store (or equivalent) forbids durable conversational content. */
  ephemeral: boolean;
  persistence: EffectiveVoicePersistence;
  providerId: string;
  model: string;
  voiceId: string;
  status: VoiceRuntimeStatus;
  startedAt: Date;
  endedAt: Date | null;
  usageSeconds: number;
  usageFinalized: boolean;
  usageIncomplete: boolean;
  interruptCount: number;
  errorCode: string | null;
  /** Ephemeral caption buffers — discarded on terminate. */
  inputTranscript: string;
  outputTranscript: string;
  inputFragments: TranscriptFragment[];
  outputFragments: TranscriptFragment[];
  /** Index into inputFragments of the first fragment not yet assigned to a turn. */
  consumedInputIndex: number;
  /** Prior conversation turns + this call's turns (delegated and live); fed to prepareAnswer. */
  history: VoiceHistoryTurn[];
  turns: VoiceTurn[];
  liveExchanges: VoiceLiveExchange[];
  counters: VoiceSessionCounters;
  assistant: VoiceAssistantContext | null;
  delegations: DelegationTracker;
  channel: VoiceControlChannel | null;
  provider: RealtimeVoiceProvider;
  unsubscribe: (() => void) | null;
  /** Durable operational row written (metadata only). */
  durableRowInserted: boolean;
  /** Runtime TTL guard for abandoned sessions. */
  ttlTimer: ReturnType<typeof setTimeout> | null;
  /** In-flight termination (dedupes end / provider-close / TTL races). */
  terminating: Promise<import("./lifecycle").TerminateVoiceResult> | null;
  /** Visitor accepted the recording disclosure at mint (stamped on the durable row). */
  recordingConsentAt: Date | null;
  /** Assistant recording retention captured at mint. */
  recordingRetentionDays: ResolvedVoiceSettings["recordingRetentionDays"];
  /** Active best-effort recorder; null when the session is not recorded. */
  recording: import("./recording/service").ActiveVoiceRecording | null;
  /**
   * Timeline V2 turn-offset resolver, set when a V2 recording starts and kept after
   * it stops (final turns persist after the recorder is flushed). Absent otherwise:
   * turns then keep their transcript offsets.
   */
  turnOffsets?: import("./turn-offsets").VoiceTurnOffsets | null;
  /** Usage meter (checkpoints + quota enforcement); absent when not admitted by mint. */
  metering?: import("./enforcement").VoiceMeterState | null;
  /** ChatAI-side reason the session ended, reported to the client by `/end`. */
  endReason?: VoiceEndReason | null;
  /**
   * Provider confirmation (at session.started) that the browser data channel cannot
   * send commands. Undefined until session.started; anything but true fails closed.
   */
  browserCommandsBlocked?: boolean;
  /** Sideband health; absent until the control plane first needs it. */
  control?: VoiceControlState;
  supervision?: VoiceSupervisionState;
  /** Last delegate-everything reminder sent after a substantive undelegated answer (audit only). */
  scopeReminderAt?: number | null;
  /** The per-session delegation latency summary was logged. */
  latencySummaryLogged?: boolean;
  /** Voice scope audit counters (numbers only). */
  scopeAudit?: { liveNonsocial: number; preScopeEngagement: number; withheld?: number; forced?: number };
  /** Playback gate: which assistant speech the visitor may hear. */
  gate?: import("./turn-gate").VoiceGateState;
};

export type VoiceEndReason =
  | "usage_limit"
  | "superseded"
  | "idle"
  | "heartbeat_lost"
  | "control_lost"
  | "max_duration"
  /** Graceful server shutdown (deploy/restart drain); widget visitors see `disconnected`. */
  | "shutdown";

export function emptyVoiceCounters(): VoiceSessionCounters {
  return {
    delegations: 0,
    answered: 0,
    superseded: 0,
    bargeIns: 0,
    lateResultsDiscarded: 0,
    appendRejected: 0,
    ragFailures: 0,
    providerErrors: 0,
    delegationTimeouts: 0,
    controlDisconnects: 0,
    controlRecoveries: 0,
  };
}

export function voiceControlOf(session: VoiceRuntimeSession): VoiceControlState {
  session.control ??= {
    state: "attached",
    lostAt: null,
    attempts: 0,
    lastGapMs: null,
    possibleLoss: false,
    interruptedDelegations: [],
  };
  return session.control;
}

/**
 * Runtime session registry. Sessions hold live objects (sideband socket, timers,
 * abort controllers), so they are owned by the process that minted them.
 *
 * V1 ships only the process-local store: deployments must run a single web instance
 * or route by voice session id (sticky sessions). A shared implementation would keep
 * serializable session metadata centrally and forward end/control calls to the owning
 * instance without changing callers of this interface.
 */
export type VoiceRuntimeStore = {
  get(sessionId: string): VoiceRuntimeSession | undefined;
  getByProviderSessionId(providerSessionId: string): VoiceRuntimeSession | undefined;
  register(session: VoiceRuntimeSession): void;
  unregister(sessionId: string): void;
  list(): VoiceRuntimeSession[];
  size(): number;
  clear(): void;
};

export function createProcessLocalVoiceRuntimeStore(): VoiceRuntimeStore {
  const bySessionId = new Map<string, VoiceRuntimeSession>();
  const byProviderSessionId = new Map<string, string>();
  return {
    get: (sessionId) => bySessionId.get(sessionId),
    getByProviderSessionId: (providerSessionId) => {
      const id = byProviderSessionId.get(providerSessionId);
      return id ? bySessionId.get(id) : undefined;
    },
    register: (session) => {
      bySessionId.set(session.sessionId, session);
      byProviderSessionId.set(session.providerSessionId, session.sessionId);
    },
    unregister: (sessionId) => {
      const session = bySessionId.get(sessionId);
      if (!session) return;
      bySessionId.delete(sessionId);
      byProviderSessionId.delete(session.providerSessionId);
    },
    list: () => [...bySessionId.values()],
    size: () => bySessionId.size,
    clear: () => {
      bySessionId.clear();
      byProviderSessionId.clear();
    },
  };
}

const globalKey = "__chatai_voice_runtime_store__";

function store(): VoiceRuntimeStore {
  const g = globalThis as typeof globalThis & { [globalKey]?: VoiceRuntimeStore };
  if (!g[globalKey]) {
    g[globalKey] = createProcessLocalVoiceRuntimeStore();
  }
  return g[globalKey];
}

/** Swap the runtime store (tests, or a future shared implementation). */
export function setVoiceRuntimeStore(next: VoiceRuntimeStore): void {
  const g = globalThis as typeof globalThis & { [globalKey]?: VoiceRuntimeStore };
  g[globalKey] = next;
}

export function getVoiceRuntime(sessionId: string): VoiceRuntimeSession | undefined {
  return store().get(sessionId);
}

export function registerVoiceRuntime(session: VoiceRuntimeSession): void {
  store().register(session);
}

export function unregisterVoiceRuntime(sessionId: string): void {
  store().unregister(sessionId);
}

export function listVoiceRuntimes(): VoiceRuntimeSession[] {
  return store().list();
}

/** Test helper — clears process-local runtime. */
export function clearVoiceRuntimeForTests(): void {
  store().clear();
}

export function applyControlEvent(
  session: VoiceRuntimeSession,
  event: VoiceControlEvent,
): void {
  switch (event.type) {
    case "session.started":
      if (session.status === "connecting") session.status = "connected";
      session.browserCommandsBlocked = event.browserCommandsBlocked === true;
      break;
    case "transcript.input.delta":
      session.inputTranscript += event.text;
      session.inputFragments.push({ text: event.text, startMs: event.startMs, endMs: event.endMs });
      if (session.supervision) {
        session.supervision.idleSince = voiceNow();
        session.supervision.idleWarnedAt = null;
      }
      break;
    case "transcript.output.delta": {
      session.outputTranscript += event.text;
      const withheld = session.gate ? session.gate.decision.state !== "open" : false;
      session.outputFragments.push({
        text: event.text,
        startMs: event.startMs,
        endMs: event.endMs,
        ...(withheld ? { withheld: true } : {}),
      });
      if (withheld && session.gate) session.gate.lastWithheldOutputAt = Date.now();
      break;
    }
    case "assistant.interrupted":
      session.interruptCount += 1;
      break;
    case "usage.updated":
      // Cumulative snapshot: replaces the previous one; a late smaller value is ignored.
      session.usageSeconds = Math.max(session.usageSeconds, event.seconds);
      break;
    case "session.closed":
      session.usageSeconds = event.usageSeconds;
      session.usageFinalized = true;
      session.usageIncomplete = false;
      session.status = "ended";
      session.endedAt = session.endedAt ?? new Date();
      break;
    case "error":
      session.errorCode = event.code;
      break;
    default:
      break;
  }
}

/** Abort in-flight delegation work so late RAG results can never be appended. */
export function abortVoiceTurns(
  session: VoiceRuntimeSession,
  reason: VoiceTurn["supersededBy"],
): void {
  for (const turn of session.turns) {
    if (turn.status === "collecting" || turn.status === "retrieving" || turn.status === "generating") {
      turn.status = "superseded";
      turn.supersededBy = reason;
      turn.abort.abort();
    }
  }
}

export function discardConversationalBuffers(session: VoiceRuntimeSession): void {
  abortVoiceTurns(session, "session_closed");
  session.inputTranscript = "";
  session.outputTranscript = "";
  session.inputFragments = [];
  session.outputFragments = [];
  session.consumedInputIndex = 0;
  session.history = [];
  session.turns = [];
  session.liveExchanges = [];
}
