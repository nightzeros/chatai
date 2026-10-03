import type { MessageOutcome } from "@chatai/database";

export type AnalyticsMetrics = {
  totalConversations: number;
  totalQuestions: number;
  /** Successful answers: from the knowledge base or from earlier grounded answers. */
  answered: number;
  /** Subset of `answered` backed by retrieved knowledge in this turn. */
  answeredWithContext: number;
  /** Subset of `answered` resolved from earlier grounded turns without new retrieval. */
  answeredFromHistory: number;
  unanswered: number;
  /** Small-talk replies; excluded from the answer rate. */
  conversational: number;
  /** answered / (answered + unanswered); null before any knowledge turn. */
  answerRate: number | null;
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
  answeredWithContext: number | string;
  answeredFromHistory: number | string;
  unanswered: number | string;
  conversational: number | string;
  positiveFeedback: number | string;
  negativeFeedback: number | string;
  averageConfidence: number | string | null;
  averageResponseMs: number | string | null;
};

type UnansweredQuestionRow = {
  question: string;
  count: number | string;
};

const answeredOutcomes = new Set<MessageOutcome>(["answered_with_context", "answered_from_history"]);
const unansweredOutcomes = new Set<MessageOutcome>(["fallback_no_context", "low_confidence"]);
const confidenceOutcomes = new Set<MessageOutcome>([
  "answered_with_context",
  "fallback_no_context",
  "low_confidence",
]);

export function isAnsweredOutcome(outcome: MessageOutcome | null) {
  return outcome !== null && answeredOutcomes.has(outcome);
}

export function isKnowledgeAnswerOutcome(outcome: MessageOutcome | null) {
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

export function answerRate(answered: number, unanswered: number): number | null {
  const attempted = answered + unanswered;
  return attempted === 0 ? null : Number((answered / attempted).toFixed(3));
}

export function toAnalyticsMetrics(row: AnalyticsMetricsRow): AnalyticsMetrics {
  const answeredWithContext = Number(row.answeredWithContext);
  const answeredFromHistory = Number(row.answeredFromHistory);
  const answered = answeredWithContext + answeredFromHistory;
  const unanswered = Number(row.unanswered);
  return {
    totalConversations: Number(row.totalConversations),
    totalQuestions: Number(row.totalQuestions),
    answered,
    answeredWithContext,
    answeredFromHistory,
    unanswered,
    conversational: Number(row.conversational),
    answerRate: answerRate(answered, unanswered),
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
