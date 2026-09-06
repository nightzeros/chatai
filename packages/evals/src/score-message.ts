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

function pushUsage(
  target: ProviderUsageRecord[],
  collector: ProviderUsageRecord[] | undefined,
  usage: ProviderUsageRecord | null,
) {
  if (!usage) return;
  target.push(usage);
  collector?.push(usage);
}

export async function scoreMessage(opts: {
  chat: ChatConfig;
  context: EvalContext;
  deps?: Partial<ScorerDeps>;
  /** Filled as each judge completes — survives later persistence failures. */
  usageCollector?: ProviderUsageRecord[];
}): Promise<{ scores: EvalScoreResult[]; providerUsages: ProviderUsageRecord[] }> {
  const providerUsages: ProviderUsageRecord[] = [];

  async function track(
    promise: Promise<{ score: EvalScoreResult; usage: ProviderUsageRecord | null }>,
  ): Promise<EvalScoreResult> {
    const result = await promise;
    pushUsage(providerUsages, opts.usageCollector, result.usage);
    return result.score;
  }

  const scores = await Promise.all([
    track(scoreFaithfulness(opts.context, opts.chat, opts.deps)),
    track(scoreContextRelevance(opts.context, opts.chat, opts.deps)),
    track(scoreAnswerRelevance(opts.context, opts.chat, opts.deps)),
    track(scoreCitationCorrectness(opts.context)),
  ]);

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
