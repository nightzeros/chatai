import { generateChat } from "@chatai/ai";
import {
  finalizeAnswer,
  generateGuardedAnswer,
  generateVerifiedAnswer,
  isConversationalMessage,
  prepareAnswer,
  resolveRagSettings,
  type PreparedAnswer,
  type ProviderUsageRecord,
} from "@chatai/rag/answer";
import type { AppendResult, VoiceControlEvent } from "@chatai/voice";

import { resolveAssistantModels } from "@/lib/ai-config";
import { isGroundedOutcome } from "@/lib/conversation-history";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  abortChatUsageReservation,
  beginChatUsageReservation,
  finishChatUsageReservation,
} from "@/lib/hosting/usage-gate";
import { createId } from "@/lib/ids";
import {
  insertVoiceAssistantMessage,
  insertVoiceLiveExchange,
  insertVoiceUserMessage,
  updateVoiceAssistantMessageSpoken,
  writeLifecycleVoiceEvent,
} from "./persist";
import type {
  TranscriptFragment,
  VoiceLiveExchange,
  VoiceRuntimeSession,
  VoiceTurn,
} from "./session-runtime";
import {
  cancelPendingOpen,
  classifyVoiceTurn,
  setVoiceGate,
  voiceGateOf,
  type VoiceGateOpenReason,
  type VoiceGateState,
  type VoiceUtterance,
} from "./turn-gate";

/**
 * Voice turn orchestration (Topology B, client delegation, server-authoritative).
 *
 * GPT-Live emits `session.delegation.created` without utterance text, so ChatAI
 * assembles the user turn from input transcript fragments, runs the existing
 * `prepareAnswer` pipeline, and returns the grounded answer via commentary.
 *
 * The backend, not the model's delegation choice, decides who answers: every
 * utterance is classified (turn-gate.ts). Only small talk may be answered live;
 * a non-social utterance GPT-Live does not delegate gets a server-forced turn
 * through the same pipeline, answered with session-wide commentary. Speech the
 * backend has not approved is withheld by the browser's playback gate.
 *
 * Stale-result protection: every await is followed by an abort check, and the
 * channel's DelegationTracker gate rejects appends for superseded ids. Superseded
 * provider calls still finish (prepareAnswer has no cancellation hook) but their
 * results are discarded and their cost is still metered.
 */

export const VOICE_ORCHESTRATION_DEFAULTS = {
  /** Max wait for lagging input transcript after delegation.created. */
  utteranceSettleMaxMs: 700,
  /** Input fragments starting this long after the delegation offset still belong to it. */
  utteranceTailGraceMs: 300,
  /** Speech running past the delegation offset is complete once no fragment arrived for this long. */
  utteranceQuietMs: 150,
  /**
   * Assistant speech this long between two user fragments is a reply, so the
   * fragments belong to different turns. Shorter output is a barge-in cut-off.
   */
  assistantReplyMinMs: 600,
  /** User speech this long after the delegation offset may be a barge-in. */
  bargeInGraceMs: 500,
  /** Words of post-offset speech needed to treat it as a barge-in (ignores "mm"). */
  bargeInMinWords: 2,
  /**
   * A ready answer waits while post-offset user speech is unresolved (below
   * bargeInMinWords) until the speech has been quiet this long…
   */
  bargeInSettleMs: 700,
  /** …or at most this long. No speech after the offset means no wait at all. */
  bargeInHoldMaxMs: 1_500,
  /** Assistant is "speaking" if its last output fragment ended within this window. */
  speakingWindowMs: 1_200,
  /** Prior turns passed to prepareAnswer (which applies CONVERSATION_HISTORY_WINDOW). */
  historyLimit: 20,
  /** ~450 tokens; GPT-Live caps each append at 500 tokens. */
  commentaryMaxChars: 1_800,
  /** Hard bound from delegation.created to the answer; then a neutral apology. */
  delegationDeadlineMs: 15_000,
  /**
   * Audit signal: an audible live (non-delegated) reply this long to a non-social
   * utterance is logged as `voice.live_substantive`. The playback gate and
   * server-forced turns are the enforcement; this only flags gaps in them.
   */
  liveSubstantiveMinWords: 25,
  /** At most one delegate-everything reminder per window after a flagged live answer. */
  scopeReminderIntervalMs: 60_000,
  /**
   * A non-social utterance GPT-Live has not delegated after this much transcript
   * quiet gets a server-forced backend turn (sooner if GPT-Live starts replying).
   */
  forceBackendAfterMs: 400,
  /** Words GPT-Live may speak in reply to small talk before the gate closes. */
  socialReplyMaxWords: 30,
  /** An approval waits until withheld speech has been quiet this long… */
  withheldQuietMs: 300,
  /** …or its own speech starts, or at most this long (backend and system speech). */
  pendingOpenMaxMs: 3_000,
};

/** Precedes server-approved speech when GPT-Live already spoke an unapproved reply. */
export const WITHHELD_REPLY_INSTRUCTIONS =
  "Stop now. The user did not hear anything you said since their last message. Do not continue, repeat or refer to it. Say only the backend result that follows, keeping its facts exactly, and add nothing.";
/** Closes a delegation GPT-Live opened for an utterance the server already answered. */
export const ALREADY_ANSWERED_COMMENTARY =
  "This request was already answered. Do not repeat the answer and do not add anything; wait for the user.";

/** Re-states the delegation rule after GPT-Live engaged with or answered a request itself. */
export const SCOPE_REMINDER_INSTRUCTIONS =
  'Reminder: delegate everything to the backend immediately except greetings, thanks, goodbyes and short acknowledgements ("okay", "got it", "mhm"). That includes statements, single words, feelings, "what do you mean?", requests to repeat, topic changes, and accepting an offer ("yes", "tell me more"). Before the backend reply say only "One moment." or nothing: never agree, offer help, or ask about the request. Speak only the backend\'s reply, keep its facts exactly, and add nothing.';

const ENGAGEMENT_PATTERN =
  /\b(sure|absolutely|of course|certainly|happy to|glad to|i can help|i could help|i'd love to|i would love to|i'd be happy|let's (do|get|start|plan|make)|great idea|what kind of|what type of|what sort of|which \w+( \w+)? (are|do|would) you)\b/i;
const NEUTRAL_ACKNOWLEDGEMENT = /^(one moment|just a moment|one sec(ond)?|a moment)( please)?[.!]?$/i;

/**
 * Engagement words GPT-Live said before (or instead of) a backend scope decision.
 * Audit heuristic only; "One moment." is the allowed neutral acknowledgement.
 */
export function isPreScopeEngagement(text: string): boolean {
  const normalized = text.replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  if (!normalized || NEUTRAL_ACKNOWLEDGEMENT.test(normalized)) return false;
  return ENGAGEMENT_PATTERN.test(normalized);
}

export type VoiceOrchestratorDeps = {
  prepareAnswer: typeof prepareAnswer;
  generateChat: typeof generateChat;
  generateVerifiedAnswer: typeof generateVerifiedAnswer;
  resolveAssistantModels: typeof resolveAssistantModels;
  beginChatUsageReservation: typeof beginChatUsageReservation;
  finishChatUsageReservation: typeof finishChatUsageReservation;
  abortChatUsageReservation: typeof abortChatUsageReservation;
  settings: typeof VOICE_ORCHESTRATION_DEFAULTS;
  log: (event: string, fields: Record<string, unknown>) => void;
};

const defaultDeps: VoiceOrchestratorDeps = {
  prepareAnswer,
  generateChat,
  generateVerifiedAnswer,
  resolveAssistantModels,
  beginChatUsageReservation,
  finishChatUsageReservation,
  abortChatUsageReservation,
  settings: VOICE_ORCHESTRATION_DEFAULTS,
  log: (event, fields) => console.info(`[voice] ${event}`, fields),
};

let deps: VoiceOrchestratorDeps = defaultDeps;

/** Test-only dependency override. Pass null to restore defaults. */
export function setVoiceOrchestratorDepsForTests(
  overrides: Partial<VoiceOrchestratorDeps> | null,
): void {
  deps = overrides
    ? {
        ...defaultDeps,
        ...overrides,
        settings: { ...defaultDeps.settings, ...overrides.settings },
      }
    : defaultDeps;
}

const pendingWork = new WeakMap<VoiceRuntimeSession, Set<Promise<void>>>();

/** Resolves when all in-flight delegation work for the session has settled. */
export async function waitForVoiceTurnsIdle(session: VoiceRuntimeSession): Promise<void> {
  for (;;) {
    const pending = pendingWork.get(session);
    if (!pending || pending.size === 0) return;
    await Promise.allSettled([...pending]);
  }
}

function track(session: VoiceRuntimeSession, work: Promise<void>): void {
  let set = pendingWork.get(session);
  if (!set) {
    set = new Set();
    pendingWork.set(session, set);
  }
  set.add(work);
  void work.finally(() => set.delete(work));
}

const VOICE_ANSWER_STYLE = [
  "",
  "This answer will be spoken aloud by a voice assistant.",
  "Answer in one to three short sentences. No markdown, headings, tables, or URLs.",
].join("\n");

const EMPTY_UTTERANCE_COMMENTARY =
  "I didn't catch the question. Ask the user to repeat it briefly.";
const LIMIT_COMMENTARY =
  "The assistant can't look that up right now because a usage limit was reached. Apologize briefly.";
const FAILURE_COMMENTARY =
  "The knowledge lookup failed. Apologize briefly and ask the user to try again.";
export const TIMEOUT_COMMENTARY =
  "The lookup is taking too long. Apologize briefly, say you can't find that right now, and offer to try again or continue in the chat.";
export const SUPERSEDED_COMMENTARY =
  "The user moved on before this lookup finished. Do not answer or guess at the earlier question; respond to what the user just said.";

const BACKCHANNEL_PHRASES = [
  "uh huh", "mm hmm", "got it", "i see", "sounds good", "all right", "thank you", "makes sense",
  "okay", "ok", "cool", "yeah", "yes", "yep", "yup", "mhm", "mmm", "mm", "hmm", "uh", "um",
  "right", "sure", "alright", "great", "thanks", "nice", "perfect", "awesome", "fine", "good",
];
const BACKCHANNEL = new RegExp(
  `\\b(?:${[...BACKCHANNEL_PHRASES].sort((a, b) => b.length - a.length).map((p) => p.replace(/ /g, "\\s+")).join("|")})\\b`,
  "g",
);

/** Acknowledgement-only speech ("okay cool", "yeah", "got it") while the user waits for an answer. */
export function isBackchannel(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z\s]/g, " ");
  return normalized.replace(BACKCHANNEL, " ").trim() === "";
}

/** Strip citation markers and markdown so commentary reads naturally aloud. */
export function toSpeakableCommentary(answer: string, maxChars: number): string {
  let text = answer
    .replace(/\[(\d+)\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    text = lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut;
  }
  return text;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Speech during a lookup supersedes it only when it is a new request, not an acknowledgement. */
function supersedesLookup(text: string): boolean {
  return wordCount(text) >= deps.settings.bargeInMinWords && !isBackchannel(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastOutputEndMs(session: VoiceRuntimeSession): number | null {
  const last = session.outputFragments.at(-1);
  return last ? last.endMs : null;
}

function isTurnInFlight(turn: VoiceTurn): boolean {
  return turn.status === "collecting" || turn.status === "retrieving" || turn.status === "generating";
}

function newTurn(
  input: { id: string; origin: VoiceTurn["origin"]; delegationId: string | null },
  offsetMs: number,
): VoiceTurn {
  return {
    ...input,
    offsetMs,
    status: "collecting",
    userText: "",
    userStartMs: null,
    rewrittenQuery: null,
    answerText: null,
    spokenText: "",
    interrupted: false,
    supersededBy: null,
    lateResultDiscarded: false,
    rejectReason: null,
    outcome: null,
    sources: [],
    confidence: null,
    error: null,
    metrics: { delegationReceivedAt: Date.now() },
    historySupplied: null,
    retrieval: null,
    groundedAnswer: null,
    commentaryEventId: null,
    commentaryAckStartMs: null,
    outputIndexAtCommentary: null,
    outputIndexEnd: null,
    finalized: false,
    userMessageId: null,
    assistantMessageId: null,
    bargeInText: "",
    bargeInAt: null,
    withheldText: "",
    abort: new AbortController(),
  };
}

function sinceDelegation(turn: VoiceTurn): number {
  return Date.now() - turn.metrics.delegationReceivedAt;
}

function metricFields(session: VoiceRuntimeSession, turn: VoiceTurn): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
    turnId: turn.id,
    origin: turn.origin,
    delegationId: turn.delegationId,
    ephemeral: session.ephemeral,
    status: turn.status,
    ...turn.metrics,
    delegationReceivedAt: undefined,
  };
}

function supersedeTurn(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  reason: "new_delegation" | "barge_in",
): void {
  if (!isTurnInFlight(turn)) return;
  turn.status = "superseded";
  turn.supersededBy = reason;
  turn.abort.abort();
  if (turn.delegationId) session.delegations.supersede(turn.delegationId);
  session.counters.superseded += 1;
  if (turn.userText) {
    session.history.push({ role: "user", content: turn.userText });
  }
  deps.log("turn.superseded", { ...metricFields(session, turn), reason });
}

/** Discard a result that arrived after its delegation was superseded. */
function discardLateResult(session: VoiceRuntimeSession, turn: VoiceTurn, stage: string): void {
  if (turn.lateResultDiscarded) return;
  turn.lateResultDiscarded = true;
  session.counters.lateResultsDiscarded += 1;
  deps.log("late_result.discarded", { ...metricFields(session, turn), stage });
}

/**
 * Wait briefly for input transcript to catch up with the delegation offset, then
 * claim the unassigned fragments that belong to this utterance.
 */
async function collectUtterance(session: VoiceRuntimeSession, turn: VoiceTurn): Promise<string> {
  const { utteranceSettleMaxMs, utteranceTailGraceMs, utteranceQuietMs } = deps.settings;
  const deadline = Date.now() + utteranceSettleMaxMs;
  let fragmentCount = session.inputFragments.length;
  let lastArrivalAt = Date.now();
  const caughtUp = () => {
    const last = session.inputFragments.at(-1);
    return Boolean(last && last.endMs >= turn.offsetMs - 200);
  };
  // Delegation can fire mid-utterance: speech past the offset may still be transcribing.
  const settled = () => {
    const last = session.inputFragments.at(-1);
    return !last || last.endMs <= turn.offsetMs || Date.now() - lastArrivalAt >= utteranceQuietMs;
  };
  while ((!caughtUp() || !settled()) && Date.now() < deadline && !turn.abort.signal.aborted) {
    await sleep(Math.min(40, Math.max(0, deadline - Date.now())));
    if (session.inputFragments.length !== fragmentCount) {
      fragmentCount = session.inputFragments.length;
      lastArrivalAt = Date.now();
    }
  }
  // A superseded turn must not claim fragments that now belong to the newer turn.
  if (turn.abort.signal.aborted) return "";

  const start = session.consumedInputIndex;
  const pending = session.inputFragments.slice(start);
  let taken = 0;
  for (const fragment of pending) {
    if (fragment.startMs > turn.offsetMs + utteranceTailGraceMs) break;
    taken += 1;
  }
  if (taken === 0 && pending.length > 0) taken = pending.length;
  session.consumedInputIndex = start + taken;

  // Unclaimed speech can include earlier turns GPT-Live answered itself (small
  // talk, clarifications). Only the latest turn is the question; earlier turns
  // are recorded as live exchanges so they inform the query rewrite without
  // polluting retrieval.
  const claimed = pending.slice(0, taken);
  const segments = splitAtAssistantReplies(session, claimed);
  const current = segments.pop() ?? [];
  for (const [index, segment] of segments.entries()) {
    void recordLiveExchange(session, segment, (segments[index + 1] ?? current)[0]?.startMs);
  }
  turn.userStartMs = current[0]?.startMs ?? null;
  return joinFragments(current);
}

function liveExchangeFrom(
  session: VoiceRuntimeSession,
  segment: TranscriptFragment[],
  replyToMs: number | undefined,
): VoiceLiveExchange | null {
  const userText = joinFragments(segment);
  const first = segment[0];
  if (!userText || !first) return null;
  const replyFrom = segment.at(-1)!.startMs;
  const replyTo = replyToMs ?? Number.POSITIVE_INFINITY;
  const reply = session.outputFragments.filter((f) => f.startMs > replyFrom && f.startMs < replyTo);
  const heard = reply.filter((f) => !f.withheld);
  const replyText = joinFragments(heard);
  const withheldText = joinFragments(reply.filter((f) => f.withheld));
  return {
    id: `live_${first.startMs}`,
    startMs: first.startMs,
    userText,
    replyText,
    replyStartMs: replyText ? (heard[0]?.startMs ?? null) : null,
    ...(withheldText ? { withheldText } : {}),
  };
}

/** Add a turn GPT-Live answered itself to history, the owner snapshot and (durable) messages. */
function recordLiveExchange(
  session: VoiceRuntimeSession,
  segment: TranscriptFragment[],
  replyToMs: number | undefined,
): Promise<void> {
  const exchange = liveExchangeFrom(session, segment, replyToMs);
  if (!exchange) return Promise.resolve();
  auditLiveExchange(session, exchange);
  if (exchange.withheldText) {
    const audit = scopeAudit(session);
    audit.withheld = (audit.withheld ?? 0) + 1;
    deps.log("voice.live_withheld", {
      sessionId: session.sessionId,
      userWords: wordCount(exchange.userText),
      withheldWords: wordCount(exchange.withheldText),
    });
  }
  session.liveExchanges.push(exchange);
  session.history.push({ role: "user", content: exchange.userText });
  if (exchange.replyText) session.history.push({ role: "assistant", content: exchange.replyText, liveReply: true });
  const persisted = insertVoiceLiveExchange(session, exchange).catch(() => undefined);
  track(session, persisted);
  return persisted;
}

/**
 * Observability for audible live answers GPT-Live gave without delegating. With
 * the playback gate these should only be small talk; anything flagged here is a
 * gap in enforcement. Logs word counts only (never text) and sends a throttled
 * reminder of the delegation rule.
 */
function auditLiveExchange(session: VoiceRuntimeSession, exchange: VoiceLiveExchange): void {
  if (!exchange.replyText || isConversationalMessage(exchange.userText)) return;
  const audit = scopeAudit(session);
  audit.liveNonsocial += 1;
  const replyWords = wordCount(exchange.replyText);
  const engaged = isPreScopeEngagement(exchange.replyText);
  const substantive = replyWords >= deps.settings.liveSubstantiveMinWords;
  deps.log("voice.live_nonsocial", {
    sessionId: session.sessionId,
    userWords: wordCount(exchange.userText),
    replyWords,
  });
  if (engaged) {
    audit.preScopeEngagement += 1;
    deps.log("voice.pre_scope_engagement", { sessionId: session.sessionId, stage: "live_reply", replyWords });
  }
  if (!substantive && !engaged) return;
  const remind = maybeRemind(session);
  if (substantive) {
    deps.log("voice.live_substantive", {
      sessionId: session.sessionId,
      userWords: wordCount(exchange.userText),
      replyWords,
      reminded: remind,
    });
  }
}

/**
 * GPT-Live answered a backend turn itself and the gate withheld it. Numbers only;
 * a substantive reply also gets the throttled delegation reminder.
 */
function auditWithheldReply(session: VoiceRuntimeSession, turn: VoiceTurn): void {
  const audit = scopeAudit(session);
  audit.withheld = (audit.withheld ?? 0) + 1;
  const withheldWords = wordCount(turn.withheldText);
  deps.log("voice.live_withheld", {
    sessionId: session.sessionId,
    turnId: turn.id,
    origin: turn.origin,
    userWords: wordCount(turn.userText),
    withheldWords,
    reminded: withheldWords >= deps.settings.liveSubstantiveMinWords ? maybeRemind(session) : false,
  });
}

function scopeAudit(session: VoiceRuntimeSession) {
  session.scopeAudit ??= { liveNonsocial: 0, preScopeEngagement: 0 };
  return session.scopeAudit;
}

/** Throttled delegation reminder; returns whether one was sent. */
function maybeRemind(session: VoiceRuntimeSession): boolean {
  const now = Date.now();
  const channel = session.channel;
  const remind =
    channel !== null &&
    session.status === "connected" &&
    (session.scopeReminderAt == null || now - session.scopeReminderAt >= deps.settings.scopeReminderIntervalMs);
  if (remind) {
    session.scopeReminderAt = now;
    void channel.appendInstructions(SCOPE_REMINDER_INSTRUCTIONS, null).catch(() => undefined);
  }
  return remind;
}

/**
 * GPT-Live speech between the user's delegated utterance and the backend reply.
 * Anything beyond the neutral acknowledgement that engages with the request is a
 * Voice scope failure signal (numbers only are logged).
 */
function auditPreResultOutput(session: VoiceRuntimeSession, turn: VoiceTurn, outputIndex: number): void {
  const from = turn.userStartMs ?? turn.offsetMs;
  const before = session.outputFragments.slice(0, outputIndex).filter((fragment) => fragment.startMs >= from);
  const text = joinFragments(before);
  if (!isPreScopeEngagement(text)) return;
  scopeAudit(session).preScopeEngagement += 1;
  turn.metrics.preScopeEngagement = true;
  deps.log("voice.pre_scope_engagement", {
    sessionId: session.sessionId,
    delegationId: turn.delegationId,
    stage: "before_backend_reply",
    words: wordCount(text),
    scopeDecision: turn.metrics.scopeDecision,
    reminded: maybeRemind(session),
  });
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

function latencyStats(values: Array<number | undefined>) {
  const sorted = values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return { n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

/**
 * Per-session delegation latency by scope decision, for human acceptance of the
 * scope classifier's cost. Numbers only; logged once at session end.
 */
export function logDelegationLatencySummary(session: VoiceRuntimeSession): void {
  if (session.latencySummaryLogged) return;
  const answered = session.turns.filter((turn) => turn.status === "answered");
  // Sessions where GPT-Live never delegated still report their scope audit counters.
  if (answered.length === 0 && !session.scopeAudit) return;
  session.latencySummaryLogged = true;
  const groups = new Map<string, VoiceTurn[]>();
  for (const turn of answered) {
    const key = turn.metrics.scopeDecision ?? "unrecorded";
    groups.set(key, [...(groups.get(key) ?? []), turn]);
  }
  const byScope: Record<string, unknown> = {};
  for (const [key, turns] of [["all", answered] as const, ...groups]) {
    byScope[key] = {
      firstCommentaryMs: latencyStats(turns.map((t) => t.metrics.firstCommentaryMs)),
      firstSpeechMs: latencyStats(turns.map((t) => t.metrics.firstSpeechMs)),
      ragDurationMs: latencyStats(turns.map((t) => t.metrics.ragDurationMs)),
      plannerMs: latencyStats(turns.map((t) => t.metrics.plannerMs)),
      plannerWaitMs: latencyStats(turns.map((t) => t.metrics.plannerWaitMs)),
    };
  }
  deps.log("voice.delegation_latency", {
    sessionId: session.sessionId,
    answered: answered.length,
    liveExchanges: session.liveExchanges.length,
    liveNonsocial: session.scopeAudit?.liveNonsocial ?? 0,
    preScopeEngagement: session.scopeAudit?.preScopeEngagement ?? 0,
    liveWithheld: session.scopeAudit?.withheld ?? 0,
    forcedTurns: session.scopeAudit?.forced ?? 0,
    outputGuardReplaced: answered.filter((turn) => turn.metrics.outputGuardReplaced).length,
    byScope,
  });
}

/**
 * Unclaimed user speech split into utterances. Without `final`, the newest
 * utterance stays pending: it may still be delegated or its reply still running.
 */
function unclaimedSegments(session: VoiceRuntimeSession, final: boolean) {
  if (session.turns.some((turn) => turn.status === "collecting")) return null;
  const pending = session.inputFragments.slice(session.consumedInputIndex);
  if (pending.length === 0) return null;
  const segments = splitAtAssistantReplies(session, pending);
  return { segments, settled: final ? segments : segments.slice(0, -1) };
}

/**
 * Record completed non-delegated exchanges (on new user speech, and finally on
 * terminate, which also logs the session's delegation latency summary).
 */
export async function settleLiveExchanges(
  session: VoiceRuntimeSession,
  options: { final?: boolean } = {},
): Promise<void> {
  try {
    const split = unclaimedSegments(session, Boolean(options.final));
    if (!split) return;
    const writes: Promise<void>[] = [];
    for (const [index, segment] of split.settled.entries()) {
      writes.push(recordLiveExchange(session, segment, split.segments[index + 1]?.[0]?.startMs));
      session.consumedInputIndex += segment.length;
    }
    await Promise.all(writes);
  } finally {
    if (options.final) logDelegationLatencySummary(session);
  }
}

/** Read-only view of exchanges not yet settled (owner snapshot before the call ends). */
export function pendingLiveExchanges(session: VoiceRuntimeSession): VoiceLiveExchange[] {
  const split = unclaimedSegments(session, true);
  if (!split) return [];
  return split.segments.flatMap((segment, index) => {
    const exchange = liveExchangeFrom(session, segment, split.segments[index + 1]?.[0]?.startMs);
    return exchange ? [exchange] : [];
  });
}

function joinFragments(fragments: TranscriptFragment[]): string {
  return fragments
    .map((fragment) => fragment.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split user fragments wherever the assistant replied in between. */
function splitAtAssistantReplies(
  session: VoiceRuntimeSession,
  fragments: TranscriptFragment[],
): TranscriptFragment[][] {
  const segments: TranscriptFragment[][] = [];
  let segment: TranscriptFragment[] = [];
  for (const [index, fragment] of fragments.entries()) {
    const previous = fragments[index - 1];
    if (previous && assistantSpokeBetween(session, previous.startMs, fragment.startMs)) {
      segments.push(segment);
      segment = [];
    }
    segment.push(fragment);
  }
  if (segment.length > 0) segments.push(segment);
  return segments;
}

/** Audible assistant speech between two visitor fragments; withheld speech was never heard, so it splits nothing. */
function assistantSpokeBetween(session: VoiceRuntimeSession, fromMs: number, toMs: number): boolean {
  const between = session.outputFragments.filter((f) => !f.withheld && f.startMs > fromMs && f.startMs < toMs);
  if (between.length === 0) return false;
  const spanMs = Math.max(...between.map((f) => f.endMs)) - between[0]!.startMs;
  return spanMs >= deps.settings.assistantReplyMinMs;
}

/**
 * The sideband has no speech-started event; input transcript is the only signal.
 * When the user has started speaking after the delegation but has not yet said
 * enough to count as a barge-in, hold the ready answer until that speech either
 * supersedes the turn or goes quiet. Turns without post-offset speech never wait.
 */
async function holdForUnresolvedSpeech(turn: VoiceTurn): Promise<void> {
  if (!turn.bargeInText.trim() || turn.abort.signal.aborted) return;
  const { bargeInSettleMs, bargeInHoldMaxMs } = deps.settings;
  const started = Date.now();
  const deadline = started + bargeInHoldMaxMs;
  while (
    !turn.abort.signal.aborted &&
    Date.now() < deadline &&
    Date.now() - (turn.bargeInAt ?? 0) < bargeInSettleMs
  ) {
    await sleep(Math.min(40, Math.max(1, deadline - Date.now())));
  }
  turn.metrics.bargeInHoldMs = Date.now() - started;
}

/** Live speech the playback gate withheld since this turn's utterance began. */
function withheldBefore(session: VoiceRuntimeSession, turn: VoiceTurn): string {
  const from = turn.userStartMs ?? turn.offsetMs;
  return joinFragments(session.outputFragments.filter((f) => f.withheld && f.startMs >= from));
}

/**
 * Append a server-approved result for the turn (delegated, or session-wide for a
 * server-forced turn) and approve its playback. When GPT-Live already spoke an
 * unapproved reply, it is first told that nobody heard it.
 */
async function appendCommentary(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  content: string,
  approval: Exclude<VoiceGateOpenReason, "social">,
): Promise<AppendResult> {
  await holdForUnresolvedSpeech(turn);
  const channel = session.channel;
  if (!channel) return { ok: false, reason: "session_closed" };
  if (turn.abort.signal.aborted) return { ok: false, reason: "superseded" };
  const withheld = withheldBefore(session, turn);
  if (withheld) {
    turn.withheldText = withheld;
    auditWithheldReply(session, turn);
    await channel.appendInstructions(WITHHELD_REPLY_INSTRUCTIONS, null).catch(() => undefined);
    if (turn.abort.signal.aborted) return { ok: false, reason: "superseded" };
  }
  const result = await channel.appendCommentary(turn.delegationId, content);
  if (result.ok) approveTurnSpeech(session, turn, approval);
  return result;
}

async function sendFallbackCommentary(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  content: string,
): Promise<void> {
  const result = await appendCommentary(session, turn, content, "system");
  if (result.ok && turn.delegationId) {
    session.delegations.complete(turn.delegationId);
  }
}

async function runTurn(session: VoiceRuntimeSession, turn: VoiceTurn): Promise<void> {
  const assistant = session.assistant;
  if (!assistant) {
    turn.status = "failed";
    turn.error = "assistant_context_missing";
    session.counters.ragFailures += 1;
    await sendFallbackCommentary(session, turn, FAILURE_COMMENTARY);
    return;
  }

  turn.userText = await collectUtterance(session, turn);
  turn.metrics.utteranceReadyMs = sinceDelegation(turn);
  if (turn.abort.signal.aborted) return;
  // Speech that arrived during the collect wait counts toward barge-in; later
  // fragments are counted by handleInputDelta.
  const lateSpeech = session.inputFragments
    .slice(session.consumedInputIndex)
    .filter((fragment) => fragment.startMs >= turn.offsetMs + deps.settings.bargeInGraceMs);
  if (lateSpeech.length > 0) {
    turn.bargeInText = joinFragments(lateSpeech);
    turn.bargeInAt = Date.now();
  }

  if (!turn.userText) {
    turn.status = "failed";
    turn.error = "empty_utterance";
    deps.log("turn.empty_utterance", metricFields(session, turn));
    await sendFallbackCommentary(session, turn, EMPTY_UTTERANCE_COMMENTARY);
    return;
  }

  const history = session.history.slice(-deps.settings.historyLimit);
  turn.historySupplied = history.length;
  await insertVoiceUserMessage(session, turn).catch(() => undefined);
  if (!turn.abort.signal.aborted && supersedesLookup(turn.bargeInText)) {
    registerRagBargeIn(session, turn);
  }
  if (turn.abort.signal.aborted) return;

  const models = await deps.resolveAssistantModels({
    id: assistant.id,
    modelSettings: assistant.modelSettings,
  });
  const rag = resolveRagSettings(assistant.ragSettings);
  const requestId = createId();

  const gate = await deps.beginChatUsageReservation({
    account: assistant.hostingAccount,
    assistantId: assistant.id,
    requestId,
    chat: models.chat,
    embedding: models.embedding,
    billing: models.billing,
    message: turn.userText,
    historyChars: history.reduce((sum, item) => sum + item.content.length, 0),
    queryExpansionEnabled: rag.queryExpansion,
    rerankEnabled: rag.rerank,
    verifyCitationsEnabled: rag.guardrails.verifyCitations,
    hasCohereKey: Boolean(env.COHERE_API_KEY),
    outputScopeCheck: env.OUTPUT_SCOPE_CHECK,
    source: session.source,
  });
  if (turn.abort.signal.aborted) {
    if (gate.ok) await deps.abortChatUsageReservation(gate.reservation).catch(() => undefined);
    return;
  }
  if (!gate.ok) {
    turn.status = "failed";
    turn.error = gate.reason ?? "usage_limit";
    deps.log("turn.usage_blocked", metricFields(session, turn));
    await sendFallbackCommentary(session, turn, LIMIT_COMMENTARY);
    return;
  }
  const reservation = gate.reservation;

  let usages: ProviderUsageRecord[] = [];
  let finished = false;
  const finishUsage = async () => {
    if (finished) return;
    finished = true;
    await deps.finishChatUsageReservation({
      reservation,
      accountId: assistant.hostingAccount.id,
      assistantId: assistant.id,
      requestId,
      source: session.source,
      visitorId: session.visitorId,
      records: usages,
      billing: models.billing,
    });
  };

  try {
    turn.status = "retrieving";
    turn.metrics.ragStartMs = sinceDelegation(turn);
    void writeLifecycleVoiceEvent(session, "rag.started", {
      delegationId: turn.delegationId,
      ragStartMs: turn.metrics.ragStartMs,
    }).catch(() => undefined);

    const ragStarted = Date.now();
    let prepared: PreparedAnswer = await deps.prepareAnswer({
      db: db(),
      assistantId: assistant.id,
      assistantName: assistant.name ?? null,
      assistantDescription: assistant.description ?? null,
      instructions: assistant.instructions,
      mode: assistant.hallucinationMode,
      message: turn.userText,
      history,
      embedding: models.embedding,
      chat: models.chat,
      ragSettings: assistant.ragSettings,
      cohereApiKey: env.COHERE_API_KEY ?? null,
      responseStyle: VOICE_ANSWER_STYLE,
      outputGuard: env.OUTPUT_SCOPE_CHECK,
      profileAnswerRoute: env.PROFILE_ANSWER_ROUTE,
    });
    turn.metrics.ragDurationMs = Date.now() - ragStarted;
    if (prepared.scope) {
      turn.metrics.scopeDecision = prepared.scope.decision;
      if (prepared.scope.plannerMs !== undefined) turn.metrics.plannerMs = prepared.scope.plannerMs;
      if (prepared.scope.plannerWaitMs !== undefined) turn.metrics.plannerWaitMs = prepared.scope.plannerWaitMs;
      if (prepared.scope.profileVersion !== undefined) turn.metrics.profileVersion = prepared.scope.profileVersion;
    }
    turn.rewrittenQuery = prepared.query;
    turn.retrieval = {
      action: prepared.decision.action,
      contextSufficient: prepared.decision.contextSufficient,
      chunks: prepared.retrieved.slice(0, 8).map((chunk) => ({
        documentName: chunk.documentName,
        similarity: Math.round(chunk.similarity * 1000) / 1000,
        preview: chunk.content.replace(/\s+/g, " ").trim().slice(0, 240),
      })),
    };
    usages = [...prepared.providerUsages];

    if (turn.abort.signal.aborted) {
      discardLateResult(session, turn, "after_prepare");
      await finishUsage();
      return;
    }

    turn.status = "generating";
    const generateStarted = Date.now();
    // Buffered (never streamed): the output scope check runs before appendCommentary.
    const generated = await generateGuardedAnswer({
      prepared,
      question: turn.userText,
      chat: models.chat,
      verifyCitations: rag.guardrails.verifyCitations,
      outputGuard: env.OUTPUT_SCOPE_CHECK,
      systemSuffix: VOICE_ANSWER_STYLE,
      generate: async ({ system, messages }) => {
        const result = await deps.generateChat({
          config: models.chat,
          system,
          messages,
          ...(models.billing.chat === "hosted" ? { maxOutputTokens: env.HOSTED_USAGE_MAX_OUTPUT_TOKENS } : {}),
        });
        return { text: result.text, usage: result.usage };
      },
      generateVerified: deps.generateVerifiedAnswer,
      deps: { generateChat: deps.generateChat },
    });
    prepared = generated.prepared;
    usages = generated.usages;
    const answer = generated.text;
    if (generated.guard?.replaced) turn.metrics.outputGuardReplaced = true;
    turn.metrics.generateDurationMs = Date.now() - generateStarted;
    await finishUsage();

    if (turn.abort.signal.aborted) {
      discardLateResult(session, turn, "after_generate");
      return;
    }

    const final = finalizeAnswer(answer, { ...prepared, providerUsages: usages });
    turn.outcome = final.outcome;
    turn.sources = final.sources;
    turn.confidence = final.confidence;
    turn.groundedAnswer = final.answer;
    turn.answerText = toSpeakableCommentary(final.answer, deps.settings.commentaryMaxChars);

    const outputIndex = session.outputFragments.length;
    auditPreResultOutput(session, turn, outputIndex);
    const appended = await appendCommentary(session, turn, turn.answerText, "backend_answer");
    if (!appended.ok) {
      turn.rejectReason = appended.reason;
      session.counters.appendRejected += 1;
      if (appended.reason === "superseded" || appended.reason === "completed") {
        if (turn.status === "generating") {
          turn.status = "superseded";
          turn.supersededBy = turn.supersededBy ?? "new_delegation";
        }
        discardLateResult(session, turn, "append_gate");
      } else if (turn.status === "generating") {
        turn.status = "failed";
        turn.error = appended.reason;
      }
      deps.log("append.rejected", { ...metricFields(session, turn), reason: appended.reason });
      return;
    }

    if (turn.delegationId) session.delegations.complete(turn.delegationId);
    turn.status = "answered";
    // Speech during the lookup that did not supersede it was backchannel, not a turn.
    session.consumedInputIndex = session.inputFragments.length;
    turn.commentaryEventId = appended.eventId ?? null;
    turn.outputIndexAtCommentary = outputIndex;
    turn.metrics.firstCommentaryMs = sinceDelegation(turn);
    session.counters.answered += 1;

    session.history.push({ role: "user", content: turn.userText });
    session.history.push({
      role: "assistant",
      content: turn.answerText,
      ...(isGroundedOutcome(turn.outcome) ? { grounded: true } : {}),
      ...(turn.outcome === "out_of_scope" ? { redirected: true } : {}),
    });

    await insertVoiceAssistantMessage(session, turn, {
      ...final.debug,
      provider: models.chat.provider,
      voice: {
        delegationId: turn.delegationId,
        turnId: turn.id,
        origin: turn.origin,
        rewrittenQuery: turn.rewrittenQuery,
        ...(turn.withheldText ? { withheldText: turn.withheldText } : {}),
        metrics: { ...turn.metrics, delegationReceivedAt: undefined },
      },
    }).catch(() => undefined);

    deps.log("turn.answered", {
      ...metricFields(session, turn),
      outcome: turn.outcome,
      sourceCount: turn.sources.length,
      historyTurns: history.length,
    });
    void writeLifecycleVoiceEvent(session, "rag.completed", {
      delegationId: turn.delegationId,
      outcome: turn.outcome,
      sourceCount: turn.sources.length,
      metrics: { ...turn.metrics, delegationReceivedAt: undefined },
    }).catch(() => undefined);
  } catch (error) {
    if (!finished) {
      if (usages.length > 0) {
        await finishUsage().catch(() => undefined);
      } else {
        finished = true;
        await deps.abortChatUsageReservation(reservation).catch(() => undefined);
      }
    }
    if (turn.abort.signal.aborted) {
      discardLateResult(session, turn, "after_error");
      return;
    }
    await failTurn(session, turn, error);
  }
}

/** The lookup threw: fail the turn and give the live model the neutral apology. */
async function failTurn(session: VoiceRuntimeSession, turn: VoiceTurn, error: unknown): Promise<void> {
  if (turn.abort.signal.aborted || !isTurnInFlight(turn)) return;
  turn.status = "failed";
  turn.error = error instanceof Error ? error.message.slice(0, 200) : "rag_failed";
  session.counters.ragFailures += 1;
  deps.log("turn.failed", { ...metricFields(session, turn), error: turn.error });
  await sendFallbackCommentary(session, turn, FAILURE_COMMENTARY);
}

/**
 * Output the visitor heard for this turn's answer: from the commentary insertion
 * point (ack timeline when known) until the user next speaks. GPT-Live can answer
 * follow-ups from its own context without delegating; that speech belongs to no
 * ChatAI turn. Withheld speech was never played, so it is never "spoken".
 */
function spokenAnswerFragments(session: VoiceRuntimeSession, turn: VoiceTurn, end: number) {
  const ackStart = turn.commentaryAckStartMs;
  const candidates = session.outputFragments
    .slice(turn.outputIndexAtCommentary ?? end, end)
    .filter((fragment) => !fragment.withheld && (ackStart === null || fragment.startMs >= ackStart));
  const first = candidates[0];
  if (!first) return [];
  const userResumedAt = session.inputFragments.find(
    (fragment) => fragment.startMs > first.startMs,
  )?.startMs;
  return userResumedAt === undefined
    ? candidates
    : candidates.filter((fragment) => fragment.startMs < userResumedAt);
}

export function spokenAnswerText(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  end = session.outputFragments.length,
): string {
  if (turn.finalized) return turn.spokenText;
  if (turn.outputIndexAtCommentary === null) return "";
  return spokenAnswerFragments(session, turn, end)
    .map((fragment) => fragment.text)
    .join("")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?]+/, "")
    .trim();
}

/** Attribute spoken output to answered turns and persist it (durable only). */
export async function finalizeAnsweredTurns(
  session: VoiceRuntimeSession,
  options: { upToOutputIndex?: number } = {},
): Promise<void> {
  const end = options.upToOutputIndex ?? session.outputFragments.length;
  for (const turn of session.turns) {
    if (turn.finalized || turn.status !== "answered" || turn.outputIndexAtCommentary === null) {
      continue;
    }
    const spokenStartMs = spokenAnswerFragments(session, turn, end)[0]?.startMs ?? null;
    turn.spokenText = spokenAnswerText(session, turn, end);
    turn.finalized = true;
    turn.outputIndexEnd = end;
    await updateVoiceAssistantMessageSpoken(
      session,
      turn,
      spokenStartMs ?? turn.commentaryAckStartMs,
    ).catch(() => undefined);
  }
}

function isSessionLive(session: VoiceRuntimeSession): boolean {
  return (
    !session.terminating &&
    session.status !== "ending" &&
    session.status !== "ended" &&
    session.status !== "failed"
  );
}

/** Mock adapters keep their own tracker; keep ours in sync for gating/metrics. */
function trackDelegation(session: VoiceRuntimeSession, event: { delegationId: string; offsetMs: number }): void {
  if (!session.delegations.get(event.delegationId) && session.delegations.isSessionOpen()) {
    session.delegations.supersedeAllActive(event.offsetMs);
    session.delegations.create(event.delegationId, event.offsetMs);
  }
}

function handleDelegationCreated(
  session: VoiceRuntimeSession,
  event: { delegationId: string; offsetMs: number },
): void {
  if (session.status === "ending" || session.status === "ended" || session.status === "failed") {
    return;
  }
  if (session.turns.some((turn) => turn.delegationId === event.delegationId)) return;
  if (adoptLateDelegation(session, event)) return;

  void finalizeAnsweredTurns(session);
  for (const turn of session.turns) {
    supersedeTurn(session, turn, "new_delegation");
  }
  trackDelegation(session, event);

  const turn = newTurn(
    { id: event.delegationId, origin: "delegation", delegationId: event.delegationId },
    event.offsetMs,
  );
  session.turns.push(turn);
  session.counters.delegations += 1;
  deps.log("delegation.created", {
    sessionId: session.sessionId,
    delegationId: turn.delegationId,
    offsetMs: turn.offsetMs,
  });

  // GPT-Live judged this a backend request: nothing it says is approved until the answer.
  const gate = session.gate;
  if (gate) {
    clearForceTimer(gate);
    if (gate.utterance && !gate.utterance.turn) gate.utterance.turn = turn;
    setVoiceGate(session, "closed", "pending_backend");
  }
  startTurn(session, turn);
}

function startTurn(session: VoiceRuntimeSession, turn: VoiceTurn): void {
  const deadline = setTimeout(() => {
    track(session, expireDelegation(session, turn));
  }, deps.settings.delegationDeadlineMs);
  deadline.unref?.();
  track(
    session,
    runTurn(session, turn)
      // Errors before the reservation (model config, usage gate) end up here.
      .catch((error: unknown) => failTurn(session, turn, error))
      .catch(() => undefined)
      .finally(() => clearTimeout(deadline)),
  );
}

/**
 * GPT-Live delegated an utterance the server already forced a turn for. The
 * in-flight forced turn takes the delegation (one lookup, one reservation); an
 * already-answered one closes it without a second answer. A delegation placed
 * after the forced answer was heard belongs to newer speech and starts normally.
 */
function adoptLateDelegation(
  session: VoiceRuntimeSession,
  event: { delegationId: string; offsetMs: number },
): boolean {
  const forced = session.gate?.utterance?.turn;
  if (!forced || forced.origin !== "server" || forced.delegationId !== null) return false;
  const heardAnswerBefore =
    forced.outputIndexAtCommentary !== null &&
    session.outputFragments
      .slice(forced.outputIndexAtCommentary)
      .some((fragment) => !fragment.withheld && fragment.startMs < event.offsetMs);
  if (heardAnswerBefore) return false;

  if (isTurnInFlight(forced)) {
    trackDelegation(session, event);
    forced.delegationId = event.delegationId;
    session.counters.delegations += 1;
    deps.log("delegation.adopted", { ...metricFields(session, forced), offsetMs: event.offsetMs });
    return true;
  }
  if (forced.status !== "answered") return false;

  trackDelegation(session, event);
  session.counters.delegations += 1;
  const channel = session.channel;
  if (channel) {
    track(
      session,
      channel
        .appendCommentary(event.delegationId, ALREADY_ANSWERED_COMMENTARY)
        .then((result) => {
          if (result.ok) session.delegations.complete(event.delegationId);
          deps.log("delegation.closed", {
            sessionId: session.sessionId,
            delegationId: event.delegationId,
            reason: "already_answered",
            ok: result.ok,
          });
        })
        .catch(() => undefined),
    );
  }
  return true;
}

/**
 * Turn deadline: a lookup still running is failed and aborted (a late result is
 * discarded; its incurred usage is still finished by runTurn), and the live model
 * gets a neutral apology so it never waits indefinitely.
 */
async function expireDelegation(session: VoiceRuntimeSession, turn: VoiceTurn): Promise<void> {
  if (!isTurnInFlight(turn) || session.terminating) return;
  turn.status = "failed";
  turn.error = "timeout";
  turn.abort.abort();
  session.counters.delegationTimeouts += 1;
  deps.log("delegation.timeout", metricFields(session, turn));
  void writeLifecycleVoiceEvent(session, "error", {
    code: "delegation_timeout",
    delegationId: turn.delegationId,
    turnId: turn.id,
  }).catch(() => undefined);
  const result = session.channel
    ? await session.channel.appendCommentary(turn.delegationId, TIMEOUT_COMMENTARY).catch(() => null)
    : null;
  if (!result?.ok) return;
  if (turn.delegationId) session.delegations.complete(turn.delegationId);
  approveTurnSpeech(session, turn, "system");
}

/**
 * User speech superseded an outstanding lookup; its answer must never be spoken.
 * GPT-Live still holds the delegation open, so it gets a neutral result first
 * (the append gate is checked synchronously, before the local supersede closes it).
 */
function registerRagBargeIn(session: VoiceRuntimeSession, turn: VoiceTurn): void {
  if (!isTurnInFlight(turn)) return;
  // A server-forced turn has no delegation for GPT-Live to wait on.
  const closing = turn.delegationId
    ? session.channel?.appendCommentary(turn.delegationId, SUPERSEDED_COMMENTARY)
    : undefined;
  supersedeTurn(session, turn, "barge_in");
  if (closing) {
    track(
      session,
      closing
        .then((result) => deps.log("delegation.closed", { ...metricFields(session, turn), reason: "barge_in", ok: result.ok }))
        .catch(() => undefined),
    );
  }
  session.interruptCount += 1;
  session.counters.bargeIns += 1;
  deps.log("barge_in", { sessionId: session.sessionId, delegationId: turn.delegationId, stage: "rag" });
  void writeLifecycleVoiceEvent(session, "assistant.interrupted", {
    delegationId: turn.delegationId,
    stage: "rag",
  }).catch(() => undefined);
}

function handleInputDelta(
  session: VoiceRuntimeSession,
  fragment: { text: string; startMs: number; endMs: number },
): void {
  const { bargeInGraceMs, bargeInMinWords, speakingWindowMs } = deps.settings;
  void settleLiveExchanges(session);
  const current = session.turns.at(-1);
  if (!current) return;

  // Barge-in while ChatAI is still retrieving/generating: supersede so a stale
  // answer is never appended after the user has moved on.
  const lookupOutstanding =
    current.status === "retrieving" ||
    current.status === "generating" ||
    (current.status === "collecting" && Boolean(current.userText));
  if (lookupOutstanding && fragment.startMs >= current.offsetMs + bargeInGraceMs) {
    current.bargeInText += fragment.text;
    current.bargeInAt = Date.now();
    if (supersedesLookup(current.bargeInText)) {
      registerRagBargeIn(session, current);
    }
    return;
  }

  // Barge-in while the assistant is speaking the answer: GPT-Live stops natively;
  // ChatAI records the interruption so the persisted turn reflects it.
  const speaking = speakingTurn(session, current);
  if (speaking && !speaking.interrupted && speaking.outputIndexAtCommentary !== null) {
    const spoken = session.outputFragments.slice(speaking.outputIndexAtCommentary);
    const firstSpoken = spoken[0];
    const lastEnd = lastOutputEndMs(session);
    if (
      firstSpoken &&
      lastEnd !== null &&
      fragment.startMs > firstSpoken.startMs &&
      fragment.startMs <= lastEnd + speakingWindowMs
    ) {
      speaking.bargeInText += fragment.text;
      if (wordCount(speaking.bargeInText) >= bargeInMinWords) {
        speaking.interrupted = true;
        session.interruptCount += 1;
        session.counters.bargeIns += 1;
        deps.log("barge_in", { sessionId: session.sessionId, delegationId: speaking.delegationId, stage: "speech" });
        void writeLifecycleVoiceEvent(session, "assistant.interrupted", {
          delegationId: speaking.delegationId,
          stage: "speech",
        }).catch(() => undefined);
      }
    }
  }
}

/**
 * The answered turn new speech may interrupt. A turn forced for that very speech
 * already sits after it, so look past a server turn that has not answered yet.
 */
function speakingTurn(session: VoiceRuntimeSession, current: VoiceTurn): VoiceTurn | null {
  if (current.status === "answered") return current;
  if (current.origin !== "server" || !isTurnInFlight(current)) return null;
  const previous = session.turns.at(-2);
  return previous?.status === "answered" ? previous : null;
}

function handleOutputDelta(session: VoiceRuntimeSession): void {
  const current = session.turns.at(-1);
  if (
    current &&
    current.status === "answered" &&
    current.metrics.firstSpeechMs === undefined &&
    current.outputIndexAtCommentary !== null &&
    session.outputFragments.length > current.outputIndexAtCommentary
  ) {
    current.metrics.firstSpeechMs = sinceDelegation(current);
    deps.log("turn.first_speech", metricFields(session, current));
  }
}

// ── Playback gate: who may answer each utterance ─────────────────────────────

function clearForceTimer(gate: VoiceGateState): void {
  if (gate.forceTimer) clearTimeout(gate.forceTimer);
  gate.forceTimer = null;
  gate.forceDueAt = null;
}

/** Latest assistant words before `beforeMs` (heard or not): does the visitor answer a question? */
function recentAssistantText(session: VoiceRuntimeSession, beforeMs: number): string | null {
  const prior = session.outputFragments.filter((fragment) => fragment.startMs < beforeMs).slice(-12);
  if (prior.length > 0) return joinFragments(prior);
  for (let index = session.history.length - 1; index >= 0; index -= 1) {
    const message = session.history[index]!;
    if (message.role === "assistant") return message.content;
  }
  return null;
}

/** A turn still collecting will claim speech that started within its tail grace. */
function collectingTurnFor(session: VoiceRuntimeSession, fragment: TranscriptFragment): VoiceTurn | null {
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    const turn = session.turns[index]!;
    if (turn.status === "collecting" && fragment.startMs <= turn.offsetMs + deps.settings.utteranceTailGraceMs) {
      return turn;
    }
  }
  return null;
}

function continuesUtterance(
  session: VoiceRuntimeSession,
  utterance: VoiceUtterance,
  fragment: TranscriptFragment,
): boolean {
  if (assistantSpokeBetween(session, utterance.lastStartMs, fragment.startMs)) return false;
  const turn = utterance.turn;
  if (!turn || turn.status === "collecting") return true;
  // Transcript of the same breath that lagged past the turn's claim: not a new request.
  return fragment.startMs < turn.offsetMs + deps.settings.bargeInGraceMs;
}

/**
 * Reclassify the visitor's current utterance on every input fragment. New speech
 * closes the gate unless it is small talk; a non-social utterance without a turn
 * is forced to the backend if GPT-Live does not delegate it.
 */
function trackUtterance(session: VoiceRuntimeSession, fragment: TranscriptFragment): void {
  const gate = voiceGateOf(session);
  if (gate.ended || !isSessionLive(session)) return;
  const index = session.inputFragments.length - 1;
  let utterance = gate.utterance;
  const continuing = utterance !== null && continuesUtterance(session, utterance, fragment);
  if (utterance && continuing) {
    utterance.lastIndex = index;
    utterance.lastStartMs = fragment.startMs;
    utterance.lastEndMs = fragment.endMs;
    utterance.lastInputAt = Date.now();
  } else {
    utterance = {
      startIndex: index,
      lastIndex: index,
      firstStartMs: fragment.startMs,
      lastStartMs: fragment.startMs,
      lastEndMs: fragment.endMs,
      lastInputAt: Date.now(),
      kind: "backend",
      turn: collectingTurnFor(session, fragment),
      socialReplyWords: 0,
    };
    gate.utterance = utterance;
  }

  const text = joinFragments(session.inputFragments.slice(utterance.startIndex, utterance.lastIndex + 1));
  utterance.kind = classifyVoiceTurn(text, recentAssistantText(session, utterance.firstStartMs));
  clearForceTimer(gate);
  if (utterance.kind === "social") {
    utterance.socialReplyWords = 0;
    const latest = session.turns.at(-1);
    if (latest && isTurnInFlight(latest) && utterance.turn !== latest) {
      // A backchannel while the backend works: that turn's answer opens the gate.
      setVoiceGate(session, "closed", "pending_backend");
      return;
    }
    openVoiceGate(session, "social", null);
    return;
  }
  const interrupting = !continuing && (gate.decision.state === "open" || gate.pendingOpen !== null);
  setVoiceGate(session, "closed", interrupting ? "user_speaking" : "pending_backend");
  if (!utterance.turn) armForceTimer(session, utterance);
}

/** Force the utterance to the backend after `delayMs`, unless a sooner force is already due. */
function armForceTimer(
  session: VoiceRuntimeSession,
  utterance: VoiceUtterance,
  trigger: "no_delegation" | "live_output" = "no_delegation",
  delayMs: number = deps.settings.forceBackendAfterMs,
): void {
  const gate = voiceGateOf(session);
  const dueAt = Date.now() + delayMs;
  if (gate.forceTimer && gate.forceDueAt !== null && gate.forceDueAt <= dueAt) return;
  clearForceTimer(gate);
  const timer = setTimeout(() => {
    gate.forceTimer = null;
    gate.forceDueAt = null;
    if (gate.utterance !== utterance || utterance.turn || utterance.kind !== "backend") return;
    // A delegated turn still collecting may claim this speech; decide once it has.
    if (session.turns.some((turn) => turn.status === "collecting")) {
      armForceTimer(session, utterance, trigger);
      return;
    }
    forceBackendTurn(session, utterance, trigger);
  }, delayMs);
  timer.unref?.();
  gate.forceTimer = timer;
  gate.forceDueAt = dueAt;
}

/**
 * GPT-Live did not delegate a non-social utterance: run the backend for it anyway.
 * The answer goes out as session-wide commentary (no delegation id); a delegation
 * that arrives later for the same speech is adopted, never answered twice.
 */
function forceBackendTurn(
  session: VoiceRuntimeSession,
  utterance: VoiceUtterance,
  trigger: "no_delegation" | "live_output",
): void {
  const gate = voiceGateOf(session);
  clearForceTimer(gate);
  if (utterance.turn || gate.ended || !isSessionLive(session)) return;
  // Already claimed by a delegated turn's collect.
  if (session.consumedInputIndex > utterance.lastIndex) return;

  void finalizeAnsweredTurns(session);
  for (const turn of session.turns) {
    if (isTurnInFlight(turn)) registerRagBargeIn(session, turn);
  }
  gate.serverTurnSeq += 1;
  const turn = newTurn(
    { id: `srv_${gate.serverTurnSeq}`, origin: "server", delegationId: null },
    utterance.lastEndMs,
  );
  utterance.turn = turn;
  session.turns.push(turn);
  const audit = scopeAudit(session);
  audit.forced = (audit.forced ?? 0) + 1;
  deps.log("turn.forced", {
    sessionId: session.sessionId,
    turnId: turn.id,
    trigger,
    offsetMs: turn.offsetMs,
  });
  startTurn(session, turn);
}

function withheldSpeechActive(gate: VoiceGateState): boolean {
  return gate.lastWithheldOutputAt !== null && Date.now() - gate.lastWithheldOutputAt < deps.settings.withheldQuietMs;
}

/**
 * Approve speech from now on. If unapproved speech is still playing, opening now
 * would let its tail through, so the approval waits until that speech stops or the
 * approved speech itself starts (commentary ack); backend and system approvals
 * wait at most `pendingOpenMaxMs`.
 */
function openVoiceGate(session: VoiceRuntimeSession, reason: VoiceGateOpenReason, turn: VoiceTurn | null): void {
  const gate = voiceGateOf(session);
  if (gate.ended) return;
  cancelPendingOpen(gate);
  if (!withheldSpeechActive(gate)) {
    setVoiceGate(session, "open", reason);
    return;
  }
  const pending: NonNullable<VoiceGateState["pendingOpen"]> = { reason, turn, timer: null, startedAt: Date.now() };
  gate.pendingOpen = pending;
  const timer = setInterval(() => {
    if (gate.pendingOpen !== pending) {
      clearInterval(timer);
      return;
    }
    const expired = reason !== "social" && Date.now() - pending.startedAt >= deps.settings.pendingOpenMaxMs;
    if (!withheldSpeechActive(gate) || expired) {
      cancelPendingOpen(gate);
      setVoiceGate(session, "open", reason);
    }
  }, 50);
  timer.unref?.();
  pending.timer = timer;
  deps.log("gate.open_deferred", { sessionId: session.sessionId, reason, turnId: turn?.id ?? null });
}

/**
 * Approve a turn's server-authored speech unless the visitor has moved on to a
 * new request (small talk during the lookup does not count as moving on).
 */
function approveTurnSpeech(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  reason: Exclude<VoiceGateOpenReason, "social">,
): void {
  const utterance = session.gate?.utterance;
  const current =
    !utterance ||
    utterance.turn === turn ||
    (utterance.kind === "social" && !utterance.turn && session.turns.at(-1) === turn);
  if (!current) {
    deps.log("gate.approval_skipped", { sessionId: session.sessionId, turnId: turn.id, reason });
    return;
  }
  openVoiceGate(session, reason, turn);
}

/**
 * Server-initiated speech (idle check-in, limit and duration warnings, control
 * recovery). Never approved over a backend utterance that is still waiting for
 * its answer: that would make the model's unapproved reply audible.
 */
export function approveVoiceSystemSpeech(session: VoiceRuntimeSession): boolean {
  const gate = session.gate;
  if (!gate || gate.ended) return false;
  const utterance = gate.utterance;
  if (utterance && utterance.kind === "backend" && (!utterance.turn || isTurnInFlight(utterance.turn))) {
    deps.log("gate.system_withheld", { sessionId: session.sessionId });
    return false;
  }
  openVoiceGate(session, "system", null);
  return true;
}

function gateOnOutput(session: VoiceRuntimeSession): void {
  const gate = session.gate;
  const fragment = session.outputFragments.at(-1);
  if (!gate || gate.ended || !fragment) return;

  const pending = gate.pendingOpen;
  const ackStartMs = pending?.turn?.commentaryAckStartMs ?? null;
  if (pending && fragment.withheld && ackStartMs !== null && fragment.startMs >= ackStartMs) {
    // The approved commentary is what is playing now.
    delete fragment.withheld;
    cancelPendingOpen(gate);
    setVoiceGate(session, "open", pending.reason);
    return;
  }

  const utterance = gate.utterance;
  if (fragment.withheld) {
    if (utterance && utterance.kind === "backend" && !utterance.turn && fragment.startMs >= utterance.firstStartMs) {
      // GPT-Live is replying itself instead of delegating: force as soon as the visitor is quiet.
      const quietForMs = Date.now() - utterance.lastInputAt;
      armForceTimer(session, utterance, "live_output", Math.max(0, deps.settings.utteranceQuietMs - quietForMs));
    }
    return;
  }
  if (utterance && gate.decision.state === "open" && gate.decision.reason === "social") {
    utterance.socialReplyWords += wordCount(fragment.text);
    if (utterance.socialReplyWords > deps.settings.socialReplyMaxWords) {
      setVoiceGate(session, "closed", "reply_limit");
      deps.log("voice.social_reply_limit", { sessionId: session.sessionId, words: utterance.socialReplyWords });
    }
  }
}

/**
 * Entry point from the sideband supervisor. Runs after applyControlEvent has updated
 * transcript buffers for the same event.
 */
export function handleVoiceControlEvent(session: VoiceRuntimeSession, event: VoiceControlEvent): void {
  switch (event.type) {
    case "delegation.created":
      handleDelegationCreated(session, event);
      break;
    case "transcript.input.delta":
      if (session.gate) trackUtterance(session, event);
      handleInputDelta(session, event);
      break;
    case "transcript.output.delta":
      gateOnOutput(session);
      handleOutputDelta(session);
      break;
    case "append.acknowledged": {
      if (event.kind !== "commentary" || !event.clientEventId) break;
      const turn = session.turns.find((t) => t.commentaryEventId === event.clientEventId);
      if (turn && turn.metrics.commentaryAckMs === undefined) {
        turn.metrics.commentaryAckMs = sinceDelegation(turn);
        turn.commentaryAckStartMs = event.startMs;
      }
      break;
    }
    case "error":
      session.counters.providerErrors += 1;
      deps.log("provider.error", { sessionId: session.sessionId, code: event.code });
      break;
    default:
      break;
  }
}
