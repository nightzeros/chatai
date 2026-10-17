import {
  generateAgentText,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type ChatMessage,
  type EmbeddingConfig,
  type GenerateChatFn,
} from "@chatai/ai";
import type { Database, MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";

import { extractCitationIndexes, sourcesFromAnswer } from "../answer/citations";
import {
  factsSupportOverview,
  isOverviewOrIdentityRequest,
} from "../answer/overview";
import { buildContextBlocks } from "../answer/prompt";
import { loadAssistantContext, type ActiveKeyFact } from "../answer/profile";
import type { ActiveOverviewClaim } from "../answer/overview";
import type { ProviderUsageListener, ProviderUsageRecord } from "../answer/provider-usage";
import type { RagSettings } from "../answer/rag-settings";
import {
  ANSWER_SCOPE_POLICY,
  buildScopeProfile,
  renderPurposeBlock,
  templateRedirect,
} from "../answer/scope";
import type { RetrievedChunk } from "../answer/retrieve";
import {
  boundHistory,
  CONVERSATION_HISTORY_WINDOW,
  isConversationalMessage,
  toChatMessages,
  type ChatHistoryMessage,
} from "../answer/turn-plan";
import { isBasicProfileQuestion } from "../answer/profile-answer";

import {
  applyPurposeDecision,
  checkPurpose,
  purposeUsageRecord,
} from "./check-purpose";
import { assertAgentCompatible } from "./compatibility";
import { bindCitationsToTurnEvidence } from "./citation-bind";
import { shouldRunPurposePreOutput } from "./purpose-pre-output";
import { searchKnowledgeToolDefinition, type KnowledgePassage } from "./search-knowledge";
import { createUsageLedger } from "./usage-ledger";
import { verifyAgentSemanticSupport, verifyUsageRecord } from "./verify-agent-output";

const SAFE_LIMITATION =
  "I don't have verified sources for that in the available knowledge. Please ask about something covered in the documents.";

export type AssistantAgentResult = {
  answer: string;
  sources: MessageSource[];
  confidence: number;
  outcome: MessageOutcome;
  providerUsages: ProviderUsageRecord[];
  debug: MessageDebug;
  turnSnapshot: {
    turnId: string;
    answerOwner: "agent";
    chatProvider: string | null | undefined;
    chatModel: string;
  };
};

export type RunAssistantAgentDeps = {
  generateAgentText?: typeof generateAgentText;
  generateChat?: GenerateChatFn;
  checkPurpose?: typeof checkPurpose;
  verifyAgentSemanticSupport?: typeof verifyAgentSemanticSupport;
};

export async function runAssistantAgent(opts: {
  turnId: string;
  db: Database;
  assistantId: string;
  assistantName?: string | null;
  assistantDescription?: string | null;
  instructions?: string | null;
  message: string;
  history: ChatHistoryMessage[];
  chat: ChatConfig;
  embedding: EmbeddingConfig;
  ragSettings?: RagSettings | null;
  cohereApiKey?: string | null;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  onUsage?: ProviderUsageListener;
  deps?: RunAssistantAgentDeps;
}): Promise<AssistantAgentResult> {
  const compatible = assertAgentCompatible(opts.chat);
  if (!compatible.ok) {
    throw Object.assign(new Error(compatible.error), { code: compatible.code });
  }

  const ledger = createUsageLedger();
  const onUsage: ProviderUsageListener = (record) => {
    ledger.record(record);
    opts.onUsage?.(record);
  };

  const generateAgent = opts.deps?.generateAgentText ?? generateAgentText;
  const generate = opts.deps?.generateChat ?? generateChat;
  const runPurpose = opts.deps?.checkPurpose ?? checkPurpose;
  const runVerify = opts.deps?.verifyAgentSemanticSupport ?? verifyAgentSemanticSupport;

  const context = await loadAssistantContext(opts.db, opts.assistantId);
  const profile = buildScopeProfile({
    assistantName: opts.assistantName ?? null,
    description: opts.assistantDescription ?? null,
    instructions: opts.instructions ?? null,
    purpose: context.purpose,
    factHints: context.facts.map((fact) => fact.text),
    knowledgeTitles: [],
  });

  const passages: KnowledgePassage[] = [];
  const chunks: RetrievedChunk[] = [];
  let searchCalls = 0;
  let usedProfileEvidenceOnly = false;

  const profileRequest =
    isOverviewOrIdentityRequest(opts.message) || isBasicProfileQuestion(opts.message);
  const profileChunks = profileEvidenceChunks(context.facts, context.overviewClaims);
  const profileSufficient =
    profileRequest &&
    (context.overviewClaims.length > 0 || factsSupportOverview(context.facts) || context.facts.length > 0);

  if (profileSufficient && profileChunks.length > 0) {
    for (const [index, chunk] of profileChunks.entries()) {
      passages.push({
        id: String(index + 1),
        documentId: chunk.documentId,
        chunkId: chunk.chunkId,
        title: chunk.documentName,
        text: chunk.content,
        score: 1,
      });
      chunks.push(chunk);
    }
    usedProfileEvidenceOnly = true;
  }

  const searchKnowledge = searchKnowledgeToolDefinition({
    db: opts.db,
    assistantId: opts.assistantId,
    embedding: opts.embedding,
    chat: opts.chat,
    ragSettings: opts.ragSettings,
    cohereApiKey: opts.cohereApiKey,
    onUsage,
    abortSignal: opts.abortSignal,
    onPassages: (nextPassages, nextChunks) => {
      searchCalls += 1;
      usedProfileEvidenceOnly = false;
      passages.splice(0, passages.length, ...nextPassages);
      chunks.splice(0, chunks.length, ...nextChunks);
    },
  });

  const system = [
    opts.instructions?.trim() || "You are a helpful AI assistant.",
    "",
    renderPurposeBlock(profile),
    "",
    ANSWER_SCOPE_POLICY,
    "",
    "You answer using the searchKnowledge tool for organization-specific facts when needed.",
    "searchKnowledge returns passages only. You compose the final answer yourself.",
    "Cite source-backed claims with [1], [2], … matching passage ids from the latest evidence set.",
    "Do not invent citations. If passages are empty, say what is missing without fabricating facts.",
    "Do not output a generic invitation to ask questions when evidence supports an overview.",
    ...(profileSufficient && passages.length > 0
      ? [
          "",
          `Owner-approved profile evidence is already available as passages [1]–[${passages.length}].`,
          "For overview/identity questions, answer from that evidence when it is sufficient; call searchKnowledge only for missing details.",
          "Time-sensitive facts (pricing, availability) need retrieval when profile evidence is marked time_sensitive or may be stale.",
          "Passages JSON:",
          JSON.stringify({
            sources: passages.map((passage) => ({
              id: passage.id,
              title: passage.title,
              content: passage.text,
              keyFact: true,
            })),
          }),
        ]
      : []),
  ].join("\n");

  const history = boundHistory(opts.history, CONVERSATION_HISTORY_WINDOW.messages);
  const messages: ChatMessage[] = toChatMessages(history, opts.message);

  const started = Date.now();
  let text = "";
  let steps = 0;
  const debugExtras: Record<string, unknown> = {};
  let tAgentDraftMs = 0;
  let tVerifyMs = 0;
  let tPurposeMs = 0;

  try {
    if (opts.abortSignal?.aborted) {
      throw new Error("Turn cancelled.");
    }

    const generated = await generateAgent({
      config: opts.chat,
      system,
      messages,
      tools: { searchKnowledge },
      maxSteps: 6,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.abortSignal,
    });

    text = generated.text.trim();
    steps = generated.steps;
    tAgentDraftMs = Date.now() - started;

    for (const step of generated.stepUsages) {
      onUsage({
        kind: "chat_completion",
        provider: opts.chat.provider,
        model: opts.chat.model,
        usage: step.usage,
        step: step.step,
        eventId: `${opts.turnId}:${step.step}`,
      });
    }
    if (generated.stepUsages.length === 0) {
      onUsage({
        kind: "chat_completion",
        provider: opts.chat.provider,
        model: opts.chat.model,
        usage: generated.usage,
        step: "agent_total",
        eventId: `${opts.turnId}:agent_total`,
      });
    }
  } catch (error) {
    if (opts.abortSignal?.aborted) {
      return buildResult({
        turnId: opts.turnId,
        chat: opts.chat,
        answer: "The request was cancelled.",
        chunks: [],
        confidence: 0,
        outcome: "model_failure",
        usages: ledger.records(),
        started,
        steps,
        searchCalls,
        error: "aborted",
      });
    }
    throw error;
  }

  if (!text) {
    text = passages.length === 0 ? SAFE_LIMITATION : templateRedirect(profile);
  }

  // Layer B — deterministic citation binding
  const bind = bindCitationsToTurnEvidence(text, passages.length);
  if (!bind.ok) {
    text = SAFE_LIMITATION;
    debugExtras.citationBind = bind;
  }

  const socialOnly =
    searchCalls === 0 &&
    isConversationalMessage(opts.message) &&
    extractCitationIndexes(text).length === 0;

  const profileOverview =
    usedProfileEvidenceOnly &&
    searchCalls === 0 &&
    profileRequest &&
    bind.ok &&
    text !== SAFE_LIMITATION;

  // Layer C — semantic support (fail closed when unavailable). Skip pure social.
  if (!socialOnly && bind.ok && text !== SAFE_LIMITATION) {
    const verifyStarted = Date.now();
    let verify = await runVerify({
      question: opts.message,
      answer: text,
      chunks,
      chat: opts.chat,
      generate,
      abortSignal: opts.abortSignal,
    });
    if (verify.usage.totalTokens > 0) {
      onUsage(verifyUsageRecord(opts.chat, verify.usage, opts.turnId));
    }

    if (!verify.passed && !verify.unavailable && chunks.length > 0) {
      // One remediation pass
      try {
        const retry = await runGenerateChat(generate, {
          config: opts.chat,
          system: [
            "Rewrite the answer using only the numbered sources.",
            "Cite every factual claim. If sources are insufficient, say so clearly.",
          ].join(" "),
          prompt: [
            `Question: ${opts.message}`,
            `Sources:\n${buildContextBlocks(chunks)}`,
            `Previous draft (unsupported):\n${text}`,
            `Verifier reason: ${verify.reason}`,
          ].join("\n\n"),
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
        });
        onUsage({
          kind: "chat_completion",
          provider: opts.chat.provider,
          model: opts.chat.model,
          usage: retry.usage,
          step: "verify_remediate",
          eventId: `${opts.turnId}:verify_remediate`,
        });
        const remediated = retry.text.trim();
        const rebind = bindCitationsToTurnEvidence(remediated, passages.length);
        if (rebind.ok && remediated) {
          text = remediated;
          verify = await runVerify({
            question: opts.message,
            answer: text,
            chunks,
            chat: opts.chat,
            generate,
            abortSignal: opts.abortSignal,
          });
          if (verify.usage.totalTokens > 0) {
            onUsage({
              ...verifyUsageRecord(opts.chat, verify.usage, opts.turnId),
              eventId: `${opts.turnId}:verify_answer_retry`,
              step: "verify_answer_retry",
            });
          }
        }
      } catch {
        verify = { passed: false, unavailable: true, reason: "Remediation failed.", usage: verify.usage };
      }
    }

    tVerifyMs = Date.now() - verifyStarted;
    if (!verify.passed || verify.unavailable) {
      text = SAFE_LIMITATION;
      debugExtras.verify = {
        passed: verify.passed,
        unavailable: verify.unavailable,
        reason: verify.reason,
      };
    } else {
      debugExtras.verify = { passed: true };
    }
  }

  // Purpose pre-output (commercial topic). Exemptions before substantive-claim clause.
  const citationIds = extractCitationIndexes(text).map(String);
  const knowledgePassageIds = usedProfileEvidenceOnly ? [] : passages.map((passage) => passage.id);
  const profileEvidenceIds = usedProfileEvidenceOnly ? passages.map((passage) => passage.id) : [];
  const runPurposeCheck = shouldRunPurposePreOutput({
    responseClass: socialOnly ? "social_only" : profileOverview ? "profile_overview" : "other",
    citationIds,
    profileEvidenceIds,
    knowledgePassageIds,
    searchKnowledgeCalled: searchCalls > 0,
    requestIsProfileCoveredOverview: profileOverview,
    earlierCheckPurposeUncertain: false,
    draftHasSubstantiveNonSocialClaims: !socialOnly && text !== SAFE_LIMITATION,
  });

  if (runPurposeCheck && text !== SAFE_LIMITATION) {
    const purposeStarted = Date.now();
    const purposeResult = await runPurpose({
      request: opts.message,
      draft: text,
      reason: "server_pre_output",
      profile,
      chat: opts.chat,
      generate,
      abortSignal: opts.abortSignal,
    });
    tPurposeMs = Date.now() - purposeStarted;
    if (purposeResult.usage.totalTokens > 0) {
      onUsage(purposeUsageRecord(opts.chat, purposeResult.usage, opts.turnId));
    }
    const delivery = applyPurposeDecision(purposeResult, profile);
    debugExtras.purpose = {
      decision: purposeResult.decision,
      confidence: purposeResult.confidence,
      unavailable: purposeResult.unavailable,
      action: delivery.action,
    };
    if (delivery.action === "redirect" || delivery.action === "limit") {
      text = delivery.text;
    }
  }

  debugExtras.timings = {
    t_agent_draft_ms: tAgentDraftMs,
    t_verify_ms: tVerifyMs,
    t_purpose_ms: tPurposeMs,
    t_validated_ready_ms: Date.now() - started,
  };

  const bestScore = chunks[0]?.similarity ?? 0;
  const limited = text === SAFE_LIMITATION || Boolean(debugExtras.purpose && (debugExtras.purpose as { action?: string }).action !== "deliver");
  const outcome: MessageOutcome =
    limited && passages.length === 0
      ? "fallback_no_context"
      : limited && debugExtras.verify && !(debugExtras.verify as { passed?: boolean }).passed
        ? "fallback_no_context"
        : "answered_with_context";

  return buildResult({
    turnId: opts.turnId,
    chat: opts.chat,
    answer: text,
    chunks,
    confidence: bestScore,
    outcome: bind.ok && !limited ? outcome : text === SAFE_LIMITATION ? "fallback_no_context" : outcome,
    usages: ledger.records(),
    started,
    steps,
    searchCalls,
    debugExtras,
  });
}

function profileEvidenceChunks(
  facts: ActiveKeyFact[],
  overviewClaims: ActiveOverviewClaim[],
): RetrievedChunk[] {
  const chunks: RetrievedChunk[] = [];
  for (const fact of facts) {
    chunks.push({
      chunkId: `fact:${fact.id}`,
      documentId: fact.documentId,
      documentName: fact.documentName,
      content: fact.text,
      similarity: 1,
      keyFact: true,
    });
  }
  for (const claim of overviewClaims) {
    chunks.push({
      chunkId: `overview:${claim.id}`,
      documentId: claim.sources[0]?.documentId ?? "key-facts",
      documentName: "Approved overview",
      content: claim.text,
      similarity: 1,
      keyFact: true,
    });
  }
  return chunks;
}

function buildResult(opts: {
  turnId: string;
  chat: ChatConfig;
  answer: string;
  chunks: RetrievedChunk[];
  confidence: number;
  outcome: MessageOutcome;
  usages: ProviderUsageRecord[];
  started: number;
  steps: number;
  searchCalls: number;
  error?: string;
  debugExtras?: Record<string, unknown>;
}): AssistantAgentResult {
  const sources: MessageSource[] =
    opts.outcome === "fallback_no_context" || opts.outcome === "model_failure"
      ? []
      : sourcesFromAnswer(opts.answer, opts.chunks);

  return {
    answer: opts.answer,
    sources,
    confidence: opts.confidence,
    outcome: opts.outcome,
    providerUsages: opts.usages,
    debug: {
      question: opts.turnId,
      turn: { kind: "knowledge", retrieval: opts.searchCalls > 0 ? "performed" : "skipped" },
      retrieval: opts.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        similarity: Number(chunk.similarity.toFixed(4)),
      })),
      decision: {
        contextSufficient: opts.chunks.length > 0,
        confidence: opts.confidence >= 0.5 ? "high" : "low",
        bestScore: Number(opts.confidence.toFixed(4)),
        mode: "balanced",
        action: "generate",
      },
      model: opts.chat.model,
      latencyMs: Date.now() - opts.started,
      answerOwner: "agent",
      agentSteps: opts.steps,
      searchKnowledgeCalls: opts.searchCalls,
      ...(opts.debugExtras ?? {}),
      ...(opts.error ? { error: opts.error } : {}),
    },
    turnSnapshot: {
      turnId: opts.turnId,
      answerOwner: "agent",
      chatProvider: opts.chat.provider,
      chatModel: opts.chat.model,
    },
  };
}
