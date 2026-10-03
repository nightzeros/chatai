import {
  asEmbedManyResult,
  embedMany,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type ChatMessage,
  type EmbeddingConfig,
  type GenerateChatFn,
} from "@chatai/ai";
import type { MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";
import type { Database } from "@chatai/database";

import { decide, FALLBACK_MESSAGE } from "./decide";

export { FALLBACK_MESSAGE };
import { applyGuardrails } from "./guardrails";
import { buildContextBlocks, buildSystemPrompt } from "./prompt";
import { sourcesFromAnswer } from "./citations";
import { expandQueries } from "./expand-query";
import { isUnsupportedContextAnswer, resolveFinalOutcome } from "./outcome";
import type { ProviderUsageRecord } from "./provider-usage";

import { resolveRagSettings, type RagSettings, type ResolvedRagSettings } from "./rag-settings";
import {
  HYBRID_CANDIDATE_LIMIT,
  mergeRetrievalLists,
  retrieveChunks,
  VECTOR_ONLY_LIMIT,
  type RetrievedChunk,
} from "./retrieve";
import { rerank, type RerankResult } from "./rerank";
import {
  checkOutputScope,
  isLongConversationalReply,
  riskReasons,
  type OutputGuardPlan,
} from "./output-guard";
import {
  EMPTY_ASSISTANT_CONTEXT,
  keyFactChunks,
  loadAssistantContext,
  type ActiveKeyFact,
  type AssistantContext,
} from "./profile";
import { buildProfileAnswerPrompt, isBasicProfileQuestion } from "./profile-answer";
import {
  buildScopeProfile,
  loadKnowledgeTitles,
  PARTIAL_REDIRECT_SENTENCE,
  purposeInvite,
  renderPurposeBlock,
  templateRedirect,
  type ScopeProfile,
  type ScopeResult,
} from "./scope";
import { authorize, routeScope, type AuthorizedTurn, type ScopeVerdict } from "./scope-router";
import type { HallucinationMode } from "./thresholds";
import {
  asksWhyVoiceEnded,
  buildConversationalPrompt,
  buildHistoryAnswerPrompt,
  buildVoiceUnavailablePrompt,
  isHistoryLookupSentinel,
  isSocialProtocolTurn,
  isVagueHelpRequest,
  toChatMessages,
  type ChatHistoryMessage,
  type TurnKind,
} from "./turn-plan";

export type { ChatHistoryMessage, TurnKind };
export type { ScopeResult };

export type PreparedAnswer = {
  query: string;
  retrieved: RetrievedChunk[];
  decision: ReturnType<typeof decide>;
  outcome: MessageOutcome;
  confidence: number;
  system: string;
  /** False when the reply is already final in `fallbackText` (fallback or a non-retrieval reply). */
  shouldGenerate: boolean;
  /** Text to emit when `shouldGenerate` is false. */
  fallbackText: string;
  /** Bounded recent history + the current user message, for generation. */
  messages: ChatMessage[];
  turn: {
    kind: TurnKind;
    retrieval: "performed" | "skipped";
    /** A history follow-up needed facts the conversation did not contain. */
    lookupAfterHistory?: boolean;
  };
  debug: MessageDebug;
  /** Owner-only scope decision and classifier timings (also in `debug.scope`). */
  scope?: ScopeResult;
  /** Provider sub-calls during prepare (plan/rewrite, expand, embed, rerank, non-retrieval replies). */
  providerUsages: ProviderUsageRecord[];
  /** The request generation addresses (only the in-scope part of a mixed request). */
  answerRequest?: string;
  /** Server-appended after a generated answer (the partial-request sentence). */
  answerSuffix?: string;
  /** Output scope check context (present when the output guard is enabled). */
  guard?: OutputGuardPlan;
};

export type FinalAnswer = {
  answer: string;
  sources: MessageSource[];
  confidence: number;
  outcome: MessageOutcome;
  debug: MessageDebug;
  providerUsages: ProviderUsageRecord[];
};

export type PrepareAnswerDeps = {
  generateChat: GenerateChatFn;
  loadKnowledgeTitles: (db: Database, assistantId: string) => Promise<string[]>;
  loadAssistantContext: (db: Database, assistantId: string) => Promise<AssistantContext>;
};

type RetrievalRun = {
  query: string;
  retrieved: RetrievedChunk[];
  retrievalError?: string;
  expansionMeta?: { expanded: boolean; queries: string[]; alternates: string[] };
  rerankMeta?: Pick<RerankResult, "provider" | "order"> & { enabled: boolean };
  usages: ProviderUsageRecord[];
  retrieveMs: number;
  finishedAt: number;
};

/** Expand → embed → retrieve → merge → rerank. Never throws; usages are always returned. */
async function runRetrieval(
  query: string,
  opts: {
    db: Database;
    assistantId: string;
    embedding: EmbeddingConfig;
    chat: ChatConfig;
    cohereApiKey?: string | null;
    rag: ResolvedRagSettings;
  },
): Promise<RetrievalRun> {
  const { rag } = opts;
  const started = Date.now();
  const usages: ProviderUsageRecord[] = [];
  const run: RetrievalRun = { query, retrieved: [], usages, retrieveMs: 0, finishedAt: 0 };

  try {
    const expansion = await expandQueries({
      query,
      chat: opts.chat,
      enabled: rag.queryExpansion,
    });
    run.expansionMeta = {
      expanded: expansion.expanded,
      queries: expansion.queries,
      alternates: expansion.alternates,
    };
    if (expansion.usage) {
      usages.push({
        kind: "chat_completion",
        provider: opts.chat.provider,
        model: opts.chat.model,
        usage: expansion.usage,
        step: "expand_query",
      });
    }

    const candidateLimit = rag.hybridSearch ? HYBRID_CANDIDATE_LIMIT : VECTOR_ONLY_LIMIT;
    const embedResult = asEmbedManyResult(await embedMany(expansion.queries, opts.embedding));
    usages.push({
      kind: "embedding",
      provider: opts.embedding.provider,
      model: opts.embedding.model,
      usage: embedResult.usage,
      step: "query_embedding",
    });

    const retrievalLists = await Promise.all(
      expansion.queries.map(async (searchQuery, index) => {
        const queryEmbedding = embedResult.embeddings[index];
        if (!queryEmbedding) {
          throw new Error("Failed to embed query.");
        }
        return retrieveChunks({
          db: opts.db,
          assistantId: opts.assistantId,
          embedding: queryEmbedding,
          query: searchQuery,
          hybridSearch: rag.hybridSearch,
          limit: candidateLimit,
        });
      }),
    );

    const merged =
      retrievalLists.length > 1
        ? mergeRetrievalLists(retrievalLists, candidateLimit)
        : (retrievalLists[0] ?? []);

    const rerankResult = await rerank({
      chunks: merged,
      query,
      chat: opts.chat,
      enabled: rag.rerank,
      cohereApiKey: opts.cohereApiKey,
    });
    run.retrieved = rerankResult.chunks;
    usages.push(...rerankResult.providerUsages);
    run.rerankMeta = {
      enabled: rag.rerank,
      provider: rerankResult.provider,
      order: rerankResult.order,
    };
  } catch (error) {
    run.retrievalError = error instanceof Error ? error.message : "Retrieval failed.";
  }

  run.finishedAt = Date.now();
  run.retrieveMs = run.finishedAt - started;
  return run;
}

/**
 * Shared answer preparation for text and Voice, and the single scope enforcement
 * point for both.
 *
 * Conversation history and retrieval are separate: every turn sees bounded recent
 * history, and retrieval runs only when the turn needs knowledge. Social protocol
 * is answered without retrieval; a follow-up that only restates facts from earlier
 * grounded answers is answered from those answers, falling back to retrieval when
 * they do not contain the fact. Callers persist every turn regardless of the path.
 *
 * Scope: the Scope Router decides in / partial / out against the Purpose (owner
 * Instructions only narrow it). "out" gets a short redirect without retrieval or
 * generation; "partial" sends only the in-scope request to generation and the
 * server appends a fixed sentence; "unknown" (classifier failure) runs sources-only
 * rules at the strict threshold, so a failure never enables general knowledge.
 * Scope is not grounding: an in-scope question without a Knowledge match keeps the
 * normal fallback rather than a redirect.
 */
export async function prepareAnswer(opts: {
  db: Database;
  assistantId: string;
  /** Used only to describe the assistant in redirects and to the classifier. */
  assistantName?: string | null;
  /** Owner-written assistant description (domain statement when nothing else is configured). */
  assistantDescription?: string | null;
  instructions: string | null;
  mode: HallucinationMode;
  message: string;
  history?: ChatHistoryMessage[];
  embedding: EmbeddingConfig;
  chat: ChatConfig;
  ragSettings?: RagSettings | null;
  cohereApiKey?: string | null;
  /** Extra style rules for replies produced here (e.g. spoken output). */
  responseStyle?: string;
  /** Client reports Voice became unavailable earlier in this conversation (no reason given). */
  voiceUnavailable?: boolean;
  /** Attach the output scope check plan (defaults off; callers pass OUTPUT_SCOPE_CHECK). */
  outputGuard?: boolean;
  /** Answer basic profile questions from published key facts (PROFILE_ANSWER_ROUTE; defaults off). */
  profileAnswerRoute?: boolean;
  deps?: Partial<PrepareAnswerDeps>;
}): Promise<PreparedAnswer> {
  const started = Date.now();
  const rag = resolveRagSettings(opts.ragSettings);
  const providerUsages: ProviderUsageRecord[] = [];
  const generate = opts.deps?.generateChat ?? generateChat;
  const history = opts.history ?? [];
  const messages = toChatMessages(history, opts.message);
  const chatUsage = (usage: ProviderUsageRecord["usage"], step: string) =>
    providerUsages.push({
      kind: "chat_completion",
      provider: opts.chat.provider,
      model: opts.chat.model,
      usage,
      step,
    });
  const retrievalOpts = {
    db: opts.db,
    assistantId: opts.assistantId,
    embedding: opts.embedding,
    chat: opts.chat,
    cohereApiKey: opts.cohereApiKey,
    rag,
  };

  const voiceQuestion = opts.voiceUnavailable === true && asksWhyVoiceEnded(opts.message);
  const usesClassifier =
    !voiceQuestion && !isSocialProtocolTurn(opts.message, history) && !isVagueHelpRequest(opts.message);
  // First turn: retrieval on the raw message runs while the classifier decides.
  const speculative =
    usesClassifier && messages.length === 1 ? runRetrieval(opts.message, retrievalOpts) : null;

  const [context, titles] = await Promise.all([
    (opts.deps?.loadAssistantContext ?? loadAssistantContext)(opts.db, opts.assistantId).catch(
      () => EMPTY_ASSISTANT_CONTEXT,
    ),
    usesClassifier
      ? (opts.deps?.loadKnowledgeTitles ?? loadKnowledgeTitles)(opts.db, opts.assistantId)
      : Promise.resolve([] as string[]),
  ]);
  const profile = buildScopeProfile({
    assistantName: opts.assistantName,
    description: opts.assistantDescription,
    instructions: opts.instructions,
    purpose: context.purpose,
    knowledgeTitles: titles,
    factHints: context.facts.map((fact) => fact.text),
  });
  const ownerContext = ownerContextFor(profile);

  const verdict: ScopeVerdict = await routeScope({
    message: opts.message,
    history,
    chat: opts.chat,
    generate,
    profile,
    forceSocial: voiceQuestion,
  });
  const plannerDoneAt = Date.now();
  if (verdict.usage) chatUsage(verdict.usage, "rewrite_query");

  const scope: ScopeResult = {
    decision: verdict.decision,
    ...(verdict.kind === "social" ? { socialProtocol: true } : {}),
    ...(verdict.kind === "vague_help" ? { vagueHelp: true } : {}),
    ...(verdict.decision === "partial" ? { partial: true } : {}),
    ...(verdict.classifierFallback ? { classifierFallback: true } : {}),
    ...(verdict.injectionSuspected ? { injectionSuspected: true } : {}),
    ...(verdict.timings.plannerMs !== undefined ? { plannerMs: verdict.timings.plannerMs } : {}),
    ...(speculative ? { concurrent: true } : {}),
    purposeSource: profile.purposeSource,
    ...(context.version !== null ? { profileVersion: context.version } : {}),
  };
  if (verdict.timings.plannerMs !== undefined && !speculative) scope.plannerWaitMs = verdict.timings.plannerMs;

  /** Await first-turn retrieval: its usages are always recorded; `use` decides whether its results are. */
  let speculativeRun: RetrievalRun | null = null;
  const settleSpeculative = async (use: boolean): Promise<RetrievalRun | null> => {
    if (!speculative) return null;
    speculativeRun ??= await speculative;
    if (scope.plannerWaitMs === undefined) {
      scope.plannerWaitMs = Math.max(0, plannerDoneAt - speculativeRun.finishedAt);
    }
    if (!use) {
      if (!scope.retrievalDiscarded) providerUsages.push(...speculativeRun.usages);
      scope.retrievalDiscarded = true;
    }
    return use ? speculativeRun : null;
  };

  const query = verdict.authorizedRequest;
  const skipped = (
    kind: TurnKind,
    outcome: MessageOutcome,
    text: string,
    decision: ReturnType<typeof decide>,
    extra: { system?: string; retrieved?: RetrievedChunk[]; confidence?: number } = {},
  ): PreparedAnswer => ({
    query,
    retrieved: extra.retrieved ?? [],
    decision,
    outcome,
    confidence: extra.confidence ?? 0,
    system: extra.system ?? "",
    shouldGenerate: false,
    fallbackText: text,
    messages,
    turn: { kind, retrieval: "skipped" },
    debug: {
      question: query,
      retrieval: [],
      turn: { kind, retrieval: "skipped", historyMessages: messages.length - 1 },
      decision,
      model: opts.chat.model,
      latencyMs: Date.now() - started,
      scope,
    },
    scope,
    providerUsages,
  });

  const turn: AuthorizedTurn | null = authorize(verdict);
  if (!turn) {
    await settleSpeculative(false);
    scope.redirectSource = verdict.redirectSource ?? "template";
    return skipped("knowledge", "out_of_scope", verdict.redirect ?? templateRedirect(profile), {
      contextSufficient: false,
      confidence: "low",
      bestScore: 0,
      mode: opts.mode,
      action: "fallback",
    });
  }

  const directDecision = (contextSufficient: boolean) => ({
    contextSufficient,
    confidence: "high" as const,
    bestScore: 0,
    mode: opts.mode,
    action: "generate" as const,
  });

  if (verdict.invite) {
    await settleSpeculative(false);
    return skipped("conversational", "conversational", verdict.invite, directDecision(false));
  }

  const directReply = async (
    kind: "conversational" | "from_history",
    system: string,
  ): Promise<PreparedAnswer | null> => {
    const [reply] = await Promise.all([
      runGenerateChat(generate, { config: opts.chat, system, messages }),
      speculative ? speculative.then((run) => (speculativeRun = run)) : null,
    ]);
    chatUsage(reply.usage, kind === "conversational" ? "conversational_reply" : "history_answer");
    if (kind === "from_history" && isHistoryLookupSentinel(reply.text)) return null;
    let text = reply.text.trim();
    if (!text) return null;
    if (opts.outputGuard && kind === "conversational" && isLongConversationalReply(text)) {
      const check = await checkOutputScope({
        purposeBlock: renderPurposeBlock(profile),
        request: opts.message,
        answer: text,
        chat: opts.chat,
        requestAccepted: true,
        generate,
      });
      chatUsage(check.usage, "output_scope_check");
      const passed = check.onPurpose !== false;
      scope.outputGuard = {
        gated: true,
        reasons: ["long_conversational"],
        method: "checker",
        passed,
        ...(check.onPurpose === null ? { unavailable: true } : {}),
        ...(passed ? {} : { replaced: true }),
        checkMs: check.ms,
      };
      if (!passed) text = purposeInvite(profile);
    }
    await settleSpeculative(false);
    return skipped(
      kind,
      kind === "conversational" ? "conversational" : "answered_from_history",
      text,
      directDecision(kind === "from_history"),
      { system },
    );
  };

  let lookupAfterHistory = false;
  if (verdict.route === "conversational") {
    const reply = await directReply(
      "conversational",
      voiceQuestion
        ? buildVoiceUnavailablePrompt(turn, ownerContext, opts.responseStyle)
        : buildConversationalPrompt(turn, ownerContext, opts.responseStyle),
    );
    if (reply) return reply;
  } else if (verdict.route === "from_history") {
    const reply = await directReply(
      "from_history",
      buildHistoryAnswerPrompt(turn, ownerContext, history, opts.responseStyle),
    );
    if (reply) return reply;
    lookupAfterHistory = true;
  }

  if (
    opts.profileAnswerRoute &&
    turn.decision === "in" &&
    !turn.restricted &&
    turn.kind === "substantive" &&
    context.facts.length > 0 &&
    isBasicProfileQuestion(opts.message)
  ) {
    const answered = await answerFromProfile(turn, context.facts);
    if (answered) return answered;
  }

  // A partial turn retrieves only its in-scope part; the raw first-turn message would mix in the rest.
  const reused = await settleSpeculative(turn.decision !== "partial");
  const retrieval = reused ?? (await runRetrieval(query, retrievalOpts));
  providerUsages.push(...retrieval.usages);
  const { retrieved, retrievalError, expansionMeta, rerankMeta } = retrieval;

  const effectiveMode: HallucinationMode = turn.decision === "unknown" ? "strict" : opts.mode;
  const bestScore = retrieved[0]?.similarity ?? 0;
  const decision = applyGuardrails(
    decide({
      mode: effectiveMode,
      bestScore,
      retrievedCount: retrieved.length,
    }),
    { retrievedCount: retrieved.length, guardrails: rag.guardrails },
  );

  // Published key facts ride along as background sources; they never change the decision.
  const factChunks = keyFactChunks(context.facts);
  const promptChunks = factChunks.length > 0 ? [...retrieved, ...factChunks] : retrieved;

  const system = buildSystemPrompt({
    turn,
    ownerContext,
    mode: effectiveMode,
    decision,
    hasHistory: messages.length > 1,
    hasKeyFacts: factChunks.length > 0,
  });

  const outcome: MessageOutcome = retrievalError
    ? "retrieval_failure"
    : decision.action === "fallback"
      ? "fallback_no_context"
      : decision.contextSufficient
        ? "answered_with_context"
        : decision.confidence === "low"
          ? "low_confidence"
          : "answered_with_context";

  const shouldGenerate = decision.action === "generate" && !retrievalError;
  const fallbackText = shouldGenerate
    ? FALLBACK_MESSAGE
    : turn.partial
      ? `${FALLBACK_MESSAGE} ${PARTIAL_REDIRECT_SENTENCE}`
      : turn.decision === "unknown"
        ? `${FALLBACK_MESSAGE} ${templateRedirect(profile)}`
        : FALLBACK_MESSAGE;

  const guard: OutputGuardPlan | undefined = opts.outputGuard
    ? {
        reasons: riskReasons({
          decision: turn.decision,
          injectionSuspected: verdict.injectionSuspected,
          contextSufficient: decision.contextSufficient,
          confidence: decision.confidence,
          mode: effectiveMode,
          history,
        }),
        purposeBlock: renderPurposeBlock(profile),
        request: turn.request,
        decision: turn.decision,
        injectionSuspected: verdict.injectionSuspected,
        redirect: templateRedirect(profile),
      }
    : undefined;

  const debug: MessageDebug = {
    question: retrieval.query,
    turn: {
      kind: verdict.route,
      retrieval: "performed",
      historyMessages: messages.length - 1,
      ...(lookupAfterHistory ? { lookupAfterHistory: true } : {}),
      ...(verdict.classifierFallback ? { plannerFallback: true } : {}),
    },
    retrieval: retrieved.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      similarity: Number(chunk.similarity.toFixed(4)),
    })),
    hybridSearch: rag.hybridSearch,
    ...(expansionMeta
      ? {
          expansion: {
            enabled: rag.queryExpansion,
            expanded: expansionMeta.expanded,
            queries: expansionMeta.queries,
            alternates: expansionMeta.alternates,
          },
        }
      : {}),
    ...(rerankMeta ? { rerank: rerankMeta } : {}),
    guardrails: rag.guardrails,
    ...(retrieved.some((chunk) => chunk.hybrid)
      ? {
          hybrid: retrieved
            .filter((chunk) => chunk.hybrid)
            .map((chunk) => ({
              chunkId: chunk.chunkId,
              vectorRank: chunk.hybrid?.vectorRank,
              keywordRank: chunk.hybrid?.keywordRank,
              rrfScore: Number((chunk.hybrid?.rrfScore ?? 0).toFixed(6)),
            })),
        }
      : {}),
    decision: {
      contextSufficient: decision.contextSufficient,
      confidence: decision.confidence,
      bestScore: Number(bestScore.toFixed(4)),
      mode: decision.mode,
      action: decision.action,
    },
    model: opts.chat.model,
    latencyMs: Date.now() - started,
    retrieveMs: retrieval.retrieveMs,
    ...(retrievalError ? { retrievalError } : {}),
    ...(factChunks.length > 0 ? { keyFacts: factChunks.length } : {}),
    ...(guard && guard.reasons.length > 0 ? { outputGuardPlan: guard.reasons } : {}),
    scope,
  };

  return {
    query: retrieval.query,
    retrieved: promptChunks,
    decision,
    outcome,
    confidence: bestScore,
    system,
    shouldGenerate,
    fallbackText,
    // Keep retrieved data out of the system instructions. The provider abstraction
    // currently supports text messages, not tool results. JSON keeps field boundaries
    // intact and preserves the current message count and provider-safe role sequence.
    // A partial turn sends only its authorized request; the model never sees the rest.
    messages: messages.map((item, index) =>
      index === messages.length - 1
        ? {
            ...item,
            content: JSON.stringify({
              request: turn.partial ? turn.request : item.content,
              ...JSON.parse(buildContextBlocks(promptChunks)),
            }),
          }
        : item,
    ),
    turn: {
      kind: verdict.route,
      retrieval: "performed",
      ...(lookupAfterHistory ? { lookupAfterHistory: true } : {}),
    },
    debug,
    scope,
    providerUsages,
    ...(turn.partial ? { answerRequest: turn.request, answerSuffix: PARTIAL_REDIRECT_SENTENCE } : {}),
    ...(guard ? { guard } : {}),
  };

  /** Basic identity/contact/hours question answered from published facts; null falls back to RAG. */
  async function answerFromProfile(
    authorized: AuthorizedTurn,
    facts: ActiveKeyFact[],
  ): Promise<PreparedAnswer | null> {
    const chunks = keyFactChunks(facts);
    const system = buildProfileAnswerPrompt(authorized, ownerContext, opts.responseStyle);
    const [reply] = await Promise.all([
      runGenerateChat(generate, {
        config: opts.chat,
        system,
        messages: messages.map((item, index) =>
          index === messages.length - 1
            ? {
                ...item,
                content: JSON.stringify({ request: item.content, ...JSON.parse(buildContextBlocks(chunks)) }),
              }
            : item,
        ),
      }),
      speculative ? speculative.then((run) => (speculativeRun = run)) : null,
    ]);
    chatUsage(reply.usage, "profile_answer");
    const text = reply.text.trim();
    const cited = sourcesFromAnswer(text, chunks).length > 0 && /\[\d+\]/.test(text);
    if (!text || isHistoryLookupSentinel(text) || !cited) {
      scope.profileRoute = "lookup";
      return null;
    }
    await settleSpeculative(false);
    scope.profileRoute = "answered";
    const prepared = skipped(
      "from_profile",
      "answered_with_context",
      text,
      { contextSufficient: true, confidence: "high", bestScore: 1, mode: opts.mode, action: "generate" },
      { system, retrieved: chunks, confidence: 1 },
    );
    return { ...prepared, debug: { ...prepared.debug, profile: { facts: chunks.length } } };
  }
}

/** The Purpose block plus the default persona when the owner configured nothing. */
function ownerContextFor(profile: ScopeProfile): string {
  const block = renderPurposeBlock(profile);
  return profile.purposeSource === "unconfigured"
    ? `You are a helpful AI assistant. Answer questions using the supplied knowledge base.\n\n${block}`
    : block;
}
export function finalizeAnswer(fullText: string, prepared: PreparedAnswer): FinalAnswer {
  const answer = fullText.trim() || prepared.fallbackText;
  const outcome = resolveFinalOutcome({
    preparedOutcome: prepared.outcome,
    answer,
    fallbackText: prepared.fallbackText,
  });
  const usedFallback =
    outcome === "fallback_no_context" ||
    outcome === "retrieval_failure" ||
    isUnsupportedContextAnswer(answer, prepared.fallbackText);

  const sources = usedFallback ? [] : sourcesFromAnswer(answer, prepared.retrieved);

  return {
    answer,
    sources,
    confidence: prepared.confidence,
    outcome,
    providerUsages: prepared.providerUsages,
    debug: {
      ...prepared.debug,
      sourcesUsed: sources.map((source) => source.documentName),
    },
  };
}

export type { ProviderUsageRecord };
