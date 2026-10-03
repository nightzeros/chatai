import type { ReactNode } from "react";

import { OutcomeBadge } from "@/components/chat/outcome-badge";
import { MarkdownMessage } from "@/components/playground/markdown-message";
import { SourcesBlock } from "@/components/playground/sources-block";
import type { TimelineMessage } from "@/lib/conversation-timeline";
import { cn } from "@/lib/utils";

export function formatTimestamp(date: Date | string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

function feedbackLabel(feedback: TimelineMessage["feedback"]) {
  if (feedback === "positive") return "Helpful";
  if (feedback === "negative") return "Not helpful";
  return null;
}

export function MessageBubble({
  message,
  showVoiceLabel = true,
  highlighted = false,
  children,
  aside,
}: {
  message: TimelineMessage;
  /** Inside a call block every turn is Voice, so the label is redundant there. */
  showVoiceLabel?: boolean;
  highlighted?: boolean;
  /** Extra owner detail rendered inside the bubble, below the footer. */
  children?: ReactNode;
  /** Rendered under the bubble on the same side (e.g. play-from control). */
  aside?: ReactNode;
}) {
  const isUser = message.role === "user";
  const helpful = feedbackLabel(message.feedback);
  const voiceAnswer = message.voiceDetails?.answeredBy;

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div
        data-highlighted={highlighted || undefined}
        className={cn(
          "max-w-[92%] rounded-2xl px-4 py-3 transition-shadow",
          isUser
            ? "rounded-tr-md bg-primary text-primary-foreground"
            : "rounded-tl-md border border-border bg-background",
          highlighted && "ring-2 ring-ring ring-offset-2 ring-offset-card",
        )}
      >
        {showVoiceLabel && message.modality === "voice" ? (
          <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">Voice</p>
        ) : null}
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        ) : (
          <MarkdownMessage content={message.content} />
        )}
        {!isUser ? (
          <>
            <SourcesBlock sources={message.sources} />
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {message.outcome ? <OutcomeBadge outcome={message.outcome} /> : null}
              {message.modality === "voice" && !message.outcome ? (
                <span>
                  {voiceAnswer === "knowledge"
                    ? "Answered with ChatAI Knowledge"
                    : "Voice model reply (no knowledge lookup)"}
                </span>
              ) : null}
              {message.wasInterrupted ? <span>Interrupted</span> : null}
              {helpful ? <span>{helpful}</span> : null}
              <span>{formatTimestamp(message.createdAt)}</span>
            </div>
          </>
        ) : null}
        {children}
      </div>
      {aside}
    </div>
  );
}
