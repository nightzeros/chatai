export const EVAL_METRICS = [
  "faithfulness",
  "contextRelevance",
  "answerRelevance",
  "citationCorrectness",
] as const;

export type EvalMetric = (typeof EVAL_METRICS)[number];
