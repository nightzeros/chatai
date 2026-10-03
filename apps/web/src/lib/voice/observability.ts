export type VoiceLogValue = string | number | boolean | null | undefined;

/** Ids, codes and enum values only: short and free of whitespace. */
const SAFE_STRING = /^[\w.:-]{0,80}$/;

/**
 * Structured operator log for the Voice control plane. Numbers, booleans and
 * short identifier-like strings only: free text (transcripts, provider messages,
 * URLs, keys with spaces) is replaced so it can never reach logs.
 */
export function logVoiceEvent(event: string, fields: Record<string, VoiceLogValue>): void {
  console.info(`[voice] ${event}`, sanitizeVoiceLogFields(fields));
}

export function logVoiceWarning(event: string, fields: Record<string, VoiceLogValue>): void {
  console.warn(`[voice] ${event}`, sanitizeVoiceLogFields(fields));
}

export function sanitizeVoiceLogFields(
  fields: Record<string, VoiceLogValue>,
): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      safe[key] = SAFE_STRING.test(value) && !/^sk-/.test(value) ? value : "[redacted]";
    } else if (typeof value === "number") {
      safe[key] = Number.isFinite(value) ? value : null;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}
