/** @jsxImportSource preact */
import type { WidgetMessage } from "@nightzeros/chatai-widget-core";

/** Orb/Dock captions: approved voice turns only (plus live partials already in state). */
export function VoiceCaptions({
  messages,
  open,
}: {
  messages: WidgetMessage[];
  open: boolean;
}) {
  if (!open) return null;
  const turns = messages.filter((message) => message.modality === "voice");
  if (turns.length === 0) {
    return (
      <div className="chatai-voice-captions is-empty" aria-live="polite">
        <p>Captions appear as you talk.</p>
      </div>
    );
  }

  const recent = turns.slice(-6);
  return (
    <div className="chatai-voice-captions" aria-live="polite">
      {recent.map((message, index) => (
        <p
          key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
          className={`chatai-voice-caption ${message.role}${message.live ? " is-live" : ""}`}
        >
          <span className="chatai-voice-caption-who">
            {message.role === "user" ? "You" : "Assistant"}
          </span>
          <span className="chatai-voice-caption-text">{message.content || "…"}</span>
          {message.interrupted ? (
            <span className="chatai-voice-caption-note">Interrupted</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}
