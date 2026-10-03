import type { VoiceRecordingView } from "./playback";

export type RecordingCardState = {
  playable: boolean;
  /** Pending recordings are re-checked until they settle. */
  poll: boolean;
  tone: "default" | "muted" | "warning" | "error";
  message: string;
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/** Status line + affordances for the owner's "Voice recording" card. */
export function recordingCardState(
  recording: Pick<VoiceRecordingView, "status" | "partial" | "expiresAt" | "deletedAt">,
  options: { unavailable?: boolean } = {},
): RecordingCardState {
  if (options.unavailable) {
    return { playable: false, poll: false, tone: "error", message: "Recording is no longer available." };
  }
  switch (recording.status) {
    case "pending":
      return { playable: false, poll: true, tone: "muted", message: "Recording is being saved…" };
    case "failed":
      return {
        playable: false,
        poll: false,
        tone: "error",
        message: "Recording could not be saved. The Voice conversation itself was not affected.",
      };
    case "expired":
      return {
        playable: false,
        poll: false,
        tone: "muted",
        message: recording.deletedAt
          ? `Recording deleted on ${formatDate(recording.deletedAt)} by the retention setting.`
          : "Recording deleted by the retention setting.",
      };
    case "ready": {
      const retention = recording.expiresAt
        ? `Deleted automatically on ${formatDate(recording.expiresAt)} (recording retention).`
        : "Kept while this conversation is kept.";
      return {
        playable: true,
        poll: false,
        tone: recording.partial ? "warning" : "default",
        message: recording.partial
          ? `Recording ended unexpectedly; saved up to the interruption. ${retention}`
          : retention,
      };
    }
  }
}

export function formatClock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
