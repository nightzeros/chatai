import {
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
  emptyProviderUsage,
} from "@chatai/ai";
import type { ProviderUsageRecord } from "@chatai/rag/answer";

import { parseJudgeVerdict } from "../parse-score";
import type { EvalContext, EvalScoreResult } from "../types";

export type ScorerDeps = {
  generateChat: GenerateChatFn;
};

export type JudgeScoreResult = {
  score: number;
  reason?: string;
  usage: ProviderUsage;
};

async function judgeScore(opts: {
  chat: ChatConfig;
  system: string;
  prompt: string;
  generateChat: GenerateChatFn;
}): Promise<JudgeScoreResult> {
  const { text: raw, usage } = await runGenerateChat(opts.generateChat, {
    config: opts.chat,
    system: opts.system,
    prompt: opts.prompt,
  });
  const verdict = parseJudgeVerdict(raw);
  return {
    score: verdict.score,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
    usage: usage ?? emptyProviderUsage(),
  };
}

function judgeUsageRecord(
  chat: ChatConfig,
  usage: ProviderUsage,
  step: string,
): ProviderUsageRecord {
  return {
    kind: "chat_completion",
    provider: chat.provider,
    model: chat.model,
    usage,
    step,
  };
}

export async function scoreFaithfulness(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<{ score: EvalScoreResult; usage: ProviderUsageRecord | null }> {
  const generate = deps?.generateChat ?? generateChat;
  const result = await judgeScore({
    chat,
    generateChat: generate,
    system:
      'You grade whether an answer is supported by the provided context. Return ONLY JSON like {"score":0.0,"reason":"brief explanation"} where score is between 0 and 1.',
    prompt: `Question: ${context.question}\n\nContext:\n${context.context}\n\nAnswer:\n${context.answer}\n\nScore how faithful the answer is to the context.`,
  });

  return {
    score: {
      metric: "faithfulness",
      score: result.score,
      details: { judge: "llm", ...(result.reason ? { reason: result.reason } : {}) },
    },
    usage: judgeUsageRecord(chat, result.usage, "eval_judge_faithfulness"),
  };
}

export async function scoreContextRelevance(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<{ score: EvalScoreResult; usage: ProviderUsageRecord | null }> {
  const generate = deps?.generateChat ?? generateChat;
  const result = await judgeScore({
    chat,
    generateChat: generate,
    system:
      'You grade whether retrieved context is relevant to the question. Return ONLY JSON like {"score":0.0,"reason":"brief explanation"} where score is between 0 and 1.',
    prompt: `Question: ${context.question}\n\nContext:\n${context.context}\n\nScore how relevant the context is for answering the question.`,
  });

  return {
    score: {
      metric: "contextRelevance",
      score: result.score,
      details: { judge: "llm", ...(result.reason ? { reason: result.reason } : {}) },
    },
    usage: judgeUsageRecord(chat, result.usage, "eval_judge_context_relevance"),
  };
}

export async function scoreAnswerRelevance(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<{ score: EvalScoreResult; usage: ProviderUsageRecord | null }> {
  const generate = deps?.generateChat ?? generateChat;
  const result = await judgeScore({
    chat,
    generateChat: generate,
    system:
      'You grade whether an answer addresses the question. Return ONLY JSON like {"score":0.0,"reason":"brief explanation"} where score is between 0 and 1.',
    prompt: [
      `Question: ${context.question}`,
      context.expectedAnswer ? `Expected answer (rubric):\n${context.expectedAnswer}` : null,
      `Answer:\n${context.answer}`,
      "Score how directly the answer addresses the question.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  return {
    score: {
      metric: "answerRelevance",
      score: result.score,
      details: { judge: "llm", ...(result.reason ? { reason: result.reason } : {}) },
    },
    usage: judgeUsageRecord(chat, result.usage, "eval_judge_answer_relevance"),
  };
}

export async function scoreCitationCorrectness(
  context: EvalContext,
): Promise<{ score: EvalScoreResult; usage: ProviderUsageRecord | null }> {
  const citations = [...context.answer.matchAll(/\[(\d+)\]/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (citations.length === 0) {
    return {
      score: {
        metric: "citationCorrectness",
        score: context.sources.length === 0 ? 1 : 0.5,
        details: { citations: [], note: "no_inline_citations" },
      },
      usage: null,
    };
  }

  const maxIndex = context.retrieval.length;
  const invalid = citations.filter((index) => index > maxIndex);
  const valid = citations.filter((index) => index <= maxIndex);

  if (invalid.length > 0) {
    return {
      score: {
        metric: "citationCorrectness",
        score: 0,
        details: { citations, invalid, maxIndex },
      },
      usage: null,
    };
  }

  const citedSources = valid
    .map((index) => context.retrieval[index - 1]?.documentId)
    .filter((documentId): documentId is string => Boolean(documentId));
  const attachedDocuments = new Set(context.sources.map((source) => source.documentId));
  const matched = citedSources.filter((documentId) => attachedDocuments.has(documentId)).length;
  const score = citedSources.length === 0 ? 1 : matched / citedSources.length;

  const citationMappings = valid.map((marker, index) => {
    const item = context.retrieval[marker - 1];
    return {
      marker,
      documentId: citedSources[index] ?? item?.documentId,
      chunkId: item?.chunkId,
      documentName: item?.documentName,
    };
  });

  return {
    score: {
      metric: "citationCorrectness",
      score,
      details: {
        citations: valid,
        citedDocuments: citedSources,
        matched,
        citationMappings,
        retrieval: context.retrieval,
      },
    },
    usage: null,
  };
}
