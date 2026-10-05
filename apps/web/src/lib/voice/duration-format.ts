/** Pure Voice duration formatting (safe for client components). */

/** `4m 12s`, `45s`, `1h 3m`. */
export function formatVoiceDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Whole minutes for quota display (rounded down, so "left" is never overstated). */
export function voiceMinutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}
