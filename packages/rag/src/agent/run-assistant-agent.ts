import {
  generateAgentText,
  type ChatConfig,
  type ChatMessage,
  type EmbeddingConfig,
} from "@chatai/ai";
import type { Database, MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";

import { sourcesFromAnswer } from "../answer/citations";
import { loadAssistantContext } from "../answer/profile";
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
  toChatMessages,
  type ChatHistoryMessage,
} from "../answer/turn-plan";

import { assertAgentCompatible } from "./compatibility";
import { bindCitationsToTurnEvidence } from "./citation-bind";
import { searchKnowledgeToolDefinition, type KnowledgePassage } from "./search-knowledge";
import { createUsageLedger } from "./usage-ledger";

const SAFE_LIMITATION =
  "I don't have verified sources for that in the available knowledge. Please ask about something covered in the documents.";

export type AssistantAgentResult = {
  answer: string;
  sources: MessageSource[];
  confidence: number;
  outcome: MessageOutcome;
  providerUsages: ProviderUsageRecord[];
  debug: MessageDebug;
  /** Snapshot frozen for this turn. */
  turnSnapshot: {
    turnId: string;
    answerOwner: "agent";
    chatProvider: string | null | undefined;
    chatModel: string;
  };
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
      // Replace turn evidence with the latest retrieval set (citation ids reset per tool result).
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
    "You answer using the searchKnowledge tool for organization-specific facts.",
    "searchKnowledge returns passages only. You compose the final answer yourself.",
    "Cite source-backed claims with [1], [2], … matching passage ids from the latest searchKnowledge result.",
    "Do not invent citations. If passages are empty, say what is missing without fabricating facts.",
    "Do not output a generic invitation to ask questions when evidence supports an overview.",
  ].join("\n");

  const history = boundHistory(opts.history, CONVERSATION_HISTORY_WINDOW.messages);
  const messages: ChatMessage[] = toChatMessages(history, opts.message);

  const started = Date.now();
  let text = "";
  let steps = 0;

  try {
    if (opts.abortSignal?.aborted) {
      throw new Error("Turn cancelled.");
    }

    const generated = await generateAgentText({
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
    // Total usage may duplicate step sum on some providers; prefer step records when present.
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

  // Layer B: citation ids must resolve to this turn's passages.
  const bind = bindCitationsToTurnEvidence(text, passages.length);
  if (!bind.ok) {
    text = SAFE_LIMITATION;
  }

  // Layer C (semantic support) and Purpose judge are not visitor-released in this slice.
  const bestScore = chunks[0]?.similarity ?? 0;
  const outcome: MessageOutcome =
    passages.length === 0 && searchCalls > 0
      ? "fallback_no_context"
      : searchCalls === 0 && !/\[[1-9]\d*\]/.test(text)
        ? "answered_with_context"
        : "answered_with_context";

  return buildResult({
    turnId: opts.turnId,
    chat: opts.chat,
    answer: text,
    chunks,
    confidence: bestScore,
    outcome: bind.ok ? outcome : "fallback_no_context",
    usages: ledger.records(),
    started,
    steps,
    searchCalls,
  });
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
