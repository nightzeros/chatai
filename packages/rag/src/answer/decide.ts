import { FALLBACK_MESSAGE, thresholds, type HallucinationMode } from "./thresholds";

export type Decision = {
  contextSufficient: boolean;
  confidence: "high" | "medium" | "low";
  bestScore: number;
  mode: HallucinationMode;
  action: "generate" | "fallback";
};

export function decide(opts: {
  mode: HallucinationMode;
  bestScore: number;
  retrievedCount: number;
}): Decision {
  const gates = thresholds[opts.mode];
  const bestScore = opts.retrievedCount === 0 ? 0 : opts.bestScore;
  const contextSufficient = bestScore >= gates.minSimilarity;

  const confidence: Decision["confidence"] =
    bestScore >= gates.high ? "high" : bestScore >= gates.medium ? "medium" : "low";

  if (opts.mode === "strict" && !contextSufficient) {
    return {
      contextSufficient: false,
      confidence,
      bestScore,
      mode: opts.mode,
      action: "fallback",
    };
  }

  if (opts.retrievedCount === 0 && opts.mode !== "flexible") {
    return {
      contextSufficient: false,
      confidence: "low",
      bestScore: 0,
      mode: opts.mode,
      action: opts.mode === "balanced" ? "generate" : "fallback",
    };
  }

  return {
    contextSufficient,
    confidence,
    bestScore,
    mode: opts.mode,
    action: "generate",
  };
}

export { FALLBACK_MESSAGE };
