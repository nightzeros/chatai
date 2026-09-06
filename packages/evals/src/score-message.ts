import type { ChatConfig } from "@chatai/ai";
import type { ProviderUsageRecord } from "@chatai/rag/answer";

import {
  scoreAnswerRelevance,
  scoreCitationCorrectness,
  scoreContextRelevance,
  scoreFaithfulness,
  type ScorerDeps,
} from "./scorers";
import type { EvalContext, EvalScoreResult } from "./types";

export async function scoreMessage(opts: {
  chat: ChatConfig;
  context: EvalContext;
  deps?: Partial<ScorerDeps>;
}): Promise<{ scores: EvalScoreResult[]; providerUsages: ProviderUsageRecord[] }> {
  const [faithfulness, contextRelevance, answerRelevance, citationCorrectness] = await Promise.all([
    scoreFaithfulness(opts.context, opts.chat, opts.deps),
    scoreContextRelevance(opts.context, opts.chat, opts.deps),
    scoreAnswerRelevance(opts.context, opts.chat, opts.deps),
    scoreCitationCorrectness(opts.context),
  ]);

  const scores = [
    faithfulness.score,
    contextRelevance.score,
    answerRelevance.score,
    citationCorrectness.score,
  ];
  const providerUsages = [
    faithfulness.usage,
    contextRelevance.usage,
    answerRelevance.usage,
    citationCorrectness.usage,
  ].filter((row): row is ProviderUsageRecord => row != null);

  return { scores, providerUsages };
}

export function summarizeScores(scores: EvalScoreResult[]) {
  return aggregateRunSummary(scores);
}

export function aggregateRunSummary(
  scores: Array<{ metric: string; score: number; caseId?: string | null }>,
  caseCount?: number,
) {
  const byMetric = new Map<string, number[]>();
  const caseIds = new Set<string>();

  for (const item of scores) {
    const list = byMetric.get(item.metric) ?? [];
    list.push(item.score);
    byMetric.set(item.metric, list);
    if (item.caseId) {
      caseIds.add(item.caseId);
    }
  }

  const averages: Record<string, number> = {};
  for (const [metric, values] of byMetric) {
    const total = values.reduce((sum, value) => sum + value, 0);
    averages[metric] = Number((total / values.length).toFixed(4));
  }

  const resolvedCaseCount = caseCount ?? (caseIds.size || undefined);
  return {
    ...(resolvedCaseCount !== undefined ? { caseCount: resolvedCaseCount } : {}),
    scoredCount: caseIds.size || scores.length,
    averages,
  };
}
