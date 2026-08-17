import type { MessageOutcome } from "@chatai/database";

export type AnalyticsMetrics = {
  totalConversations: number;
  totalQuestions: number;
  answered: number;
  unanswered: number;
  positiveFeedback: number;
  negativeFeedback: number;
  averageConfidence: number | null;
  averageResponseMs: number | null;
};

export type TopUnansweredQuestion = {
  question: string;
  count: number;
};

type AnalyticsMetricsRow = {
  totalConversations: number | string;
  totalQuestions: number | string;
  answered: number | string;
  unanswered: number | string;
  positiveFeedback: number | string;
  negativeFeedback: number | string;
  averageConfidence: number | string | null;
  averageResponseMs: number | string | null;
};

type UnansweredQuestionRow = {
  question: string;
  count: number | string;
};

const unansweredOutcomes = new Set<MessageOutcome>(["fallback_no_context", "low_confidence"]);
const confidenceOutcomes = new Set<MessageOutcome>([
  "answered_with_context",
  "fallback_no_context",
  "low_confidence",
]);

export function isAnsweredOutcome(outcome: MessageOutcome | null) {
  return outcome === "answered_with_context";
}

export function isUnansweredOutcome(outcome: MessageOutcome | null) {
  return outcome !== null && unansweredOutcomes.has(outcome);
}

export function isConfidenceOutcome(outcome: MessageOutcome | null) {
  return outcome !== null && confidenceOutcomes.has(outcome);
}

export function normalizeQuestion(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+$/g, "");
}

export function toAnalyticsMetrics(row: AnalyticsMetricsRow): AnalyticsMetrics {
  return {
    totalConversations: Number(row.totalConversations),
    totalQuestions: Number(row.totalQuestions),
    answered: Number(row.answered),
    unanswered: Number(row.unanswered),
    positiveFeedback: Number(row.positiveFeedback),
    negativeFeedback: Number(row.negativeFeedback),
    averageConfidence: row.averageConfidence === null ? null : Number(Number(row.averageConfidence).toFixed(3)),
    averageResponseMs: row.averageResponseMs === null ? null : Math.round(Number(row.averageResponseMs)),
  };
}

export function toTopUnansweredQuestions(rows: UnansweredQuestionRow[]): TopUnansweredQuestion[] {
  const grouped = new Map<string, TopUnansweredQuestion>();
  for (const row of rows) {
    const question = row.question.trim().replace(/\s+/g, " ");
    const key = normalizeQuestion(question);
    if (!key) continue;

    const existing = grouped.get(key);
    if (existing) {
      existing.count += Number(row.count);
      continue;
    }
    grouped.set(key, { question, count: Number(row.count) });
  }

  return [...grouped.values()].sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));
}
