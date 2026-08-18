export type RagGuardrails = {
  requireContext?: boolean;
  verifyCitations?: boolean;
  refuseOnLowConfidence?: boolean;
};

export type RagSettings = {
  hybridSearch?: boolean;
  rerank?: boolean;
  queryExpansion?: boolean;
  chunkingMode?: "standard" | "parent_child";
  guardrails?: RagGuardrails;
  /** Fraction of production answers to score asynchronously (0–1). */
  evalSampleRate?: number;
};

export const defaultRagSettings: Required<
  Pick<RagSettings, "hybridSearch" | "rerank" | "queryExpansion" | "chunkingMode" | "evalSampleRate">
> & {
  guardrails: Required<RagGuardrails>;
} = {
  hybridSearch: true,
  rerank: true,
  queryExpansion: true,
  chunkingMode: "standard",
  evalSampleRate: 0,
  guardrails: {
    requireContext: false,
    verifyCitations: false,
    refuseOnLowConfidence: false,
  },
};
