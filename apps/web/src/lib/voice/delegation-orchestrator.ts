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

/**
 * Voice delegation orchestration (Topology B, client delegation).
 *
 * GPT-Live emits `session.delegation.created` without utterance text, so ChatAI
 * assembles the user turn from input transcript fragments, runs the existing
 * `prepareAnswer` pipeline, and returns the grounded answer via commentary.
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
   * Audit only, never the enforcement boundary: a live (non-delegated) reply this
   * long to a non-social utterance is logged as `voice.live_substantive`. Shorter
   * unrelated live answers are still bypasses; prevention is the delegate-every-
   * request Voice policy plus backend scope enforcement.
   */
  liveSubstantiveMinWords: 25,
  /** At most one delegate-everything reminder per window after a flagged live answer. */
  scopeReminderIntervalMs: 60_000,
};

/** Re-states the delegation rule after GPT-Live engaged with or answered a request itself. */
export const SCOPE_REMINDER_INSTRUCTIONS =
  'Reminder: delegate every request for information, advice, help, recommendations, an activity, or a task to the backend immediately, including requests that seem unrelated or name no topic. Before the backend reply say only "One moment." or nothing: never agree, offer help, or ask about the request. Speak only the backend\'s reply and add nothing. Handle yourself only greetings, thanks, goodbyes, acknowledgements, and requests to repeat something already said.';

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

function newTurn(delegationId: string, offsetMs: number): VoiceTurn {
  return {
    delegationId,
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
    abort: new AbortController(),
  };
}

function sinceDelegation(turn: VoiceTurn): number {
  return Date.now() - turn.metrics.delegationReceivedAt;
}

function metricFields(session: VoiceRuntimeSession, turn: VoiceTurn): Record<string, unknown> {
  return {
    sessionId: session.sessionId,
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
  session.delegations.supersede(turn.delegationId);
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
  const { utteranceSettleMaxMs, utteranceTailGraceMs } = deps.settings;
  const deadline = Date.now() + utteranceSettleMaxMs;
  const caughtUp = () => {
    const last = session.inputFragments.at(-1);
    return Boolean(last && last.endMs >= turn.offsetMs - 200);
  };
  while (!caughtUp() && Date.now() < deadline && !turn.abort.signal.aborted) {
    await sleep(Math.min(40, Math.max(0, deadline - Date.now())));
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
  const replyText = joinFragments(reply);
  return {
    id: `live_${first.startMs}`,
    startMs: first.startMs,
    userText,
    replyText,
    replyStartMs: replyText ? (reply[0]?.startMs ?? null) : null,
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
  session.liveExchanges.push(exchange);
  session.history.push({ role: "user", content: exchange.userText });
  if (exchange.replyText) session.history.push({ role: "assistant", content: exchange.replyText });
  const persisted = insertVoiceLiveExchange(session, exchange).catch(() => undefined);
  track(session, persisted);
  return persisted;
}

/**
 * Observability for live answers GPT-Live gave without delegating. A heuristic
 * audit signal, not scope enforcement: logs word counts only (never text) and
 * sends a throttled reminder of the delegation rule.
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

function assistantSpokeBetween(session: VoiceRuntimeSession, fromMs: number, toMs: number): boolean {
  const between = session.outputFragments.filter((f) => f.startMs > fromMs && f.startMs < toMs);
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

async function appendCommentary(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  content: string,
): Promise<AppendResult> {
  await holdForUnresolvedSpeech(turn);
  if (!session.channel) return { ok: false, reason: "session_closed" };
  if (turn.abort.signal.aborted) return { ok: false, reason: "superseded" };
  return session.channel.appendCommentary(turn.delegationId, content);
}

async function sendFallbackCommentary(
  session: VoiceRuntimeSession,
  turn: VoiceTurn,
  content: string,
): Promise<void> {
  const result = await appendCommentary(session, turn, content);
  if (result.ok) {
    session.delegations.complete(turn.delegationId);
  }
}

async function runDelegation(session: VoiceRuntimeSession, turn: VoiceTurn): Promise<void> {
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
    hasHistory: history.length > 0,
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
        const result = await deps.generateChat({ config: models.chat, system, messages });
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
    const appended = await appendCommentary(session, turn, turn.answerText);
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

    session.delegations.complete(turn.delegationId);
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
        rewrittenQuery: turn.rewrittenQuery,
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
    turn.status = "failed";
    turn.error = error instanceof Error ? error.message.slice(0, 200) : "rag_failed";
    session.counters.ragFailures += 1;
    deps.log("turn.failed", { ...metricFields(session, turn), error: turn.error });
    await sendFallbackCommentary(session, turn, FAILURE_COMMENTARY);
  }
}

/**
 * Output spoken for this turn's answer: from the commentary insertion point (ack
 * timeline when known) until the user next speaks. GPT-Live can answer follow-ups
 * from its own context without delegating; that speech belongs to no ChatAI turn.
 */
function spokenAnswerFragments(session: VoiceRuntimeSession, turn: VoiceTurn, end: number) {
  const ackStart = turn.commentaryAckStartMs;
  const candidates = session.outputFragments
    .slice(turn.outputIndexAtCommentary ?? end, end)
    .filter((fragment) => ackStart === null || fragment.startMs >= ackStart);
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

function handleDelegationCreated(
  session: VoiceRuntimeSession,
  event: { delegationId: string; offsetMs: number },
): void {
  if (session.status === "ending" || session.status === "ended" || session.status === "failed") {
    return;
  }
  if (session.turns.some((turn) => turn.delegationId === event.delegationId)) return;

  void finalizeAnsweredTurns(session);
  for (const turn of session.turns) {
    supersedeTurn(session, turn, "new_delegation");
  }

  // Mock adapters keep their own tracker; keep ours in sync for gating/metrics.
  if (!session.delegations.get(event.delegationId) && session.delegations.isSessionOpen()) {
    session.delegations.supersedeAllActive(event.offsetMs);
    session.delegations.create(event.delegationId, event.offsetMs);
  }

  const turn = newTurn(event.delegationId, event.offsetMs);
  session.turns.push(turn);
  session.counters.delegations += 1;
  deps.log("delegation.created", {
    sessionId: session.sessionId,
    delegationId: turn.delegationId,
    offsetMs: turn.offsetMs,
  });

  const deadline = setTimeout(() => {
    track(session, expireDelegation(session, turn));
  }, deps.settings.delegationDeadlineMs);
  deadline.unref?.();
  track(
    session,
    runDelegation(session, turn).finally(() => clearTimeout(deadline)),
  );
}

/**
 * Delegation deadline: a lookup still running is failed and aborted (a late result
 * is discarded; its incurred usage is still finished by runDelegation), and the
 * live model gets a neutral apology so it never waits indefinitely.
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
  }).catch(() => undefined);
  const result = session.channel
    ? await session.channel.appendCommentary(turn.delegationId, TIMEOUT_COMMENTARY).catch(() => null)
    : null;
  if (result?.ok) session.delegations.complete(turn.delegationId);
}

/**
 * User speech superseded an outstanding lookup; its answer must never be spoken.
 * GPT-Live still holds the delegation open, so it gets a neutral result first
 * (the append gate is checked synchronously, before the local supersede closes it).
 */
function registerRagBargeIn(session: VoiceRuntimeSession, turn: VoiceTurn): void {
  if (!isTurnInFlight(turn)) return;
  const closing = session.channel?.appendCommentary(turn.delegationId, SUPERSEDED_COMMENTARY);
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
  if (current.status === "answered" && !current.interrupted && current.outputIndexAtCommentary !== null) {
    const spoken = session.outputFragments.slice(current.outputIndexAtCommentary);
    const firstSpoken = spoken[0];
    const lastEnd = lastOutputEndMs(session);
    if (
      firstSpoken &&
      lastEnd !== null &&
      fragment.startMs > firstSpoken.startMs &&
      fragment.startMs <= lastEnd + speakingWindowMs
    ) {
      current.bargeInText += fragment.text;
      if (wordCount(current.bargeInText) >= bargeInMinWords) {
        current.interrupted = true;
        session.interruptCount += 1;
        session.counters.bargeIns += 1;
        deps.log("barge_in", { sessionId: session.sessionId, delegationId: current.delegationId, stage: "speech" });
        void writeLifecycleVoiceEvent(session, "assistant.interrupted", {
          delegationId: current.delegationId,
          stage: "speech",
        }).catch(() => undefined);
      }
    }
  }
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
      handleInputDelta(session, event);
      break;
    case "transcript.output.delta":
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
