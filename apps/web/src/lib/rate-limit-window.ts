export function minuteWindowStart(now = new Date()): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0,
    0,
  ));
}

export function secondsUntilWindowEnd(windowStart: Date, now = new Date()): number {
  const next = windowStart.getTime() + 60_000;
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

export function evaluateRateLimit(
  count: number,
  limit: number,
  windowStart: Date,
  now = new Date(),
): { ok: true } | { ok: false; retryAfter: number } {
  if (count > limit) {
    return { ok: false, retryAfter: secondsUntilWindowEnd(windowStart, now) };
  }
  return { ok: true };
}
