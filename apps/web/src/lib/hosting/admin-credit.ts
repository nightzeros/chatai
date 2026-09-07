/**
 * Compute the next `limit_override_micros` after applying a one-time credit.
 * Credits raise the account override (or effective plan limit if no override yet).
 */
export function nextLimitOverrideAfterCredit(input: {
  currentOverrideMicros: number | null;
  effectiveLimitMicros: number;
  creditMicros: number;
}): number {
  const credit = Math.max(0, Math.floor(input.creditMicros));
  const base =
    input.currentOverrideMicros != null
      ? input.currentOverrideMicros
      : Math.max(0, Math.floor(input.effectiveLimitMicros));
  return base + credit;
}
