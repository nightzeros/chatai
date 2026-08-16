export type HallucinationMode = "strict" | "balanced" | "flexible";

export type ModeThresholds = {
  /** Minimum top-chunk similarity to treat context as sufficient */
  minSimilarity: number;
  high: number;
  medium: number;
};

/**
 * Tunable retrieval gates. Similarity is 1 - cosine distance (1 = identical).
 */
export const thresholds: Record<HallucinationMode, ModeThresholds> = {
  strict: { minSimilarity: 0.72, high: 0.86, medium: 0.72 },
  balanced: { minSimilarity: 0.52, high: 0.78, medium: 0.52 },
  flexible: { minSimilarity: 0.28, high: 0.7, medium: 0.45 },
};

export const FALLBACK_MESSAGE =
  "I couldn't find enough information in the provided sources to answer that confidently.";
