import type { ProviderUsageRecord } from "../answer/provider-usage";

/**
 * Accumulates provider usage for one turn with per-event idempotency.
 * Replaying the same eventId is a no-op; multiple distinct late events all apply.
 */
export function createUsageLedger() {
  const byEventId = new Map<string, ProviderUsageRecord>();
  const ordered: ProviderUsageRecord[] = [];
  let seq = 0;

  function record(input: ProviderUsageRecord): boolean {
    const eventId = input.eventId ?? `${input.kind}:${input.step ?? "step"}:${++seq}`;
    if (byEventId.has(eventId)) return false;
    const stored: ProviderUsageRecord = { ...input, eventId };
    byEventId.set(eventId, stored);
    ordered.push(stored);
    return true;
  }

  return {
    record,
    /** Apply late records after cancel/settle attempts; skips duplicates by eventId. */
    recordLate(records: ProviderUsageRecord[]): number {
      let applied = 0;
      for (const item of records) {
        if (record(item)) applied += 1;
      }
      return applied;
    },
    records(): ProviderUsageRecord[] {
      return [...ordered];
    },
    has(eventId: string): boolean {
      return byEventId.has(eventId);
    },
  };
}

export type UsageLedger = ReturnType<typeof createUsageLedger>;
