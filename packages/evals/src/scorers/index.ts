import { generateChat, runGenerateChat, type ChatConfig, type GenerateChatFn } from "@chatai/ai";

import { parseJudgeVerdict } from "../parse-score";
import type { EvalContext, EvalScoreResult } from "../types";

export type ScorerDeps = {
  generateChat: GenerateChatFn;
};

async function judgeScore(opts: {
  chat: ChatConfig;
  system: string;
  prompt: string;
  generateChat: GenerateChatFn;
}) {
  const { text: raw } = await runGenerateChat(opts.generateChat, {
    config: opts.chat,
    system: opts.system,
    prompt: opts.prompt,
  });
  return parseJudgeVerdict(raw);
}

export async function scoreFaithfulness(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<EvalScoreResult> {
  const generate = deps?.generateChat ?? generateChat;
  const score = await judgeScore({
    chat,
    generateChat: generate,
    system:
      'You grade whether an answer is supported by the provided context. Return ONLY JSON like {"score":0.0,"reason":"brief explanation"} where score is between 0 and 1.',
    prompt: `Question: ${context.question}\n\nContext:\n${context.context}\n\nAnswer:\n${context.answer}\n\nScore how faithful the answer is to the context.`,
  });

  return {
    metric: "faithfulness",
    score: score.score,
    details: { judge: "llm", ...(score.reason ? { reason: score.reason } : {}) },
  };
}

export async function scoreContextRelevance(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<EvalScoreResult> {
  const generate = deps?.generateChat ?? generateChat;
  const score = await judgeScore({
    chat,
    generateChat: generate,
    system:
      'You grade whether retrieved context is relevant to the question. Return ONLY JSON like {"score":0.0,"reason":"brief explanation"} where score is between 0 and 1.',
    prompt: `Question: ${context.question}\n\nContext:\n${context.context}\n\nScore how relevant the context is for answering the question.`,
  });

  return {
    metric: "contextRelevance",
    score: score.score,
    details: { judge: "llm", ...(score.reason ? { reason: score.reason } : {}) },
  };
}

export async function scoreAnswerRelevance(
  context: EvalContext,
  chat: ChatConfig,
  deps?: Partial<ScorerDeps>,
): Promise<EvalScoreResult> {
  const generate = deps?.generateChat ?? generateChat;
  const score = await judgeScore({
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
    metric: "answerRelevance",
    score: score.score,
    details: { judge: "llm", ...(score.reason ? { reason: score.reason } : {}) },
  };
}

export async function scoreCitationCorrectness(context: EvalContext): Promise<EvalScoreResult> {
  const citations = [...context.answer.matchAll(/\[(\d+)\]/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (citations.length === 0) {
    return {
      metric: "citationCorrectness",
      score: context.sources.length === 0 ? 1 : 0.5,
      details: { citations: [], note: "no_inline_citations" },
    };
  }

  const maxIndex = context.retrieval.length;
  const invalid = citations.filter((index) => index > maxIndex);
  const valid = citations.filter((index) => index <= maxIndex);

  if (invalid.length > 0) {
    return {
      metric: "citationCorrectness",
      score: 0,
      details: { citations, invalid, maxIndex },
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
    metric: "citationCorrectness",
    score,
    details: {
      citations: valid,
      citedDocuments: citedSources,
      matched,
      citationMappings,
      retrieval: context.retrieval,
    },
  };
}
