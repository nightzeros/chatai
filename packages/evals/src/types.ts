import type { MessageDebug, MessageSource } from "@chatai/database";

export type EvalRetrievalItem = NonNullable<MessageDebug["retrieval"]>[number];

export type EvalContext = {
  question: string;
  answer: string;
  context: string;
  sources: MessageSource[];
  retrieval: EvalRetrievalItem[];
  /** Optional rubric used by offline eval cases. */
  expectedAnswer?: string;
};

export type EvalScoreResult = {
  metric: string;
  score: number;
  details?: Record<string, unknown>;
};
