import { extractCitationIndexes } from "../answer/citations";

export type CitationBindResult =
  | { ok: true }
  | { ok: false; reason: string; invalid: number[] };

/**
 * Layer B — deterministic citation binding to evidence supplied this turn.
 * A valid citation id is not proof of semantic support (Layer C is separate).
 */
export function bindCitationsToTurnEvidence(
  answer: string,
  passageCount: number,
): CitationBindResult {
  const indexes = extractCitationIndexes(answer);
  if (indexes.length === 0) return { ok: true };
  if (passageCount <= 0) {
    return { ok: false, reason: "Citations present but no passages were supplied this turn.", invalid: indexes };
  }
  const invalid = indexes.filter((index) => index < 1 || index > passageCount);
  if (invalid.length > 0) {
    return {
      ok: false,
      reason: `Citation markers out of range for this turn's ${passageCount} passages.`,
      invalid,
    };
  }
  return { ok: true };
}
