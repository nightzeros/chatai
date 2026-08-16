import type { Decision } from "./decide";
import type { RetrievedChunk } from "./retrieve";
import type { HallucinationMode } from "./thresholds";

export function buildContextBlocks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "(No knowledge base passages were retrieved.)";
  }

  return chunks
    .map((chunk, index) => {
      const page = chunk.page ? `, page ${chunk.page}` : "";
      return `[${index + 1}] ${chunk.documentName}${page}\n${chunk.content}`;
    })
    .join("\n\n");
}

function modeRules(mode: HallucinationMode, decision: Decision): string {
  if (mode === "strict") {
    return [
      "STRICT mode: answer only using the numbered sources.",
      "If the sources are insufficient, say you could not find enough information.",
      "Do not use general world knowledge for factual claims.",
    ].join(" ");
  }

  if (mode === "balanced") {
    if (!decision.contextSufficient) {
      return [
        "BALANCED mode: the retrieved sources may be insufficient.",
        "You may answer simple/general questions using common knowledge.",
        "Do not invent company-specific facts, policies, pricing, or product details.",
        "If the question needs those, say the knowledge base does not contain enough information.",
      ].join(" ");
    }
    return [
      "BALANCED mode: prefer the numbered sources.",
      "You may add brief general clarification only when it does not contradict the sources.",
    ].join(" ");
  }

  return [
    "FLEXIBLE mode: prefer the numbered sources when they are relevant.",
    "You may use general model knowledge to be helpful when sources are thin.",
    "Still do not fabricate citations.",
  ].join(" ");
}

export function buildSystemPrompt(opts: {
  instructions: string | null;
  mode: HallucinationMode;
  decision: Decision;
  context: string;
}): string {
  return [
    opts.instructions?.trim() ||
      "You are a helpful AI assistant. Answer questions using the supplied knowledge base.",
    "",
    modeRules(opts.mode, opts.decision),
    "",
    "When a statement comes from a source, cite it with a bracket marker like [1] or [2].",
    "Only cite numbers that appear in the sources list. Never invent sources.",
    "",
    "Sources:",
    opts.context,
  ].join("\n");
}
