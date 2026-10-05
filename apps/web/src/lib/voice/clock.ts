let clock: () => number = () => Date.now();

/** Wall clock for Voice supervision (idle, heartbeat, re-attach windows). */
export function voiceNow(): number {
  return clock();
}

/** Test hook: deterministic supervision time. Pass null to restore Date.now. */
export function setVoiceClockForTests(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}
