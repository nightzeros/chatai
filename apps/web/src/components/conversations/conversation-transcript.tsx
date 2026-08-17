import Link from "next/link";

import { OutcomeBadge } from "@/components/chat/outcome-badge";
import { MarkdownMessage } from "@/components/playground/markdown-message";
import { SourcesBlock } from "@/components/playground/sources-block";
import type { TranscriptMessage } from "@/lib/conversation-list";
import { cn } from "@/lib/utils";

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function feedbackLabel(feedback: TranscriptMessage["feedback"]) {
  if (feedback === "positive") return "Helpful";
  if (feedback === "negative") return "Not helpful";
  return null;
}

export function ConversationTranscript({
  assistantId,
  sourceLabel,
  visitorLabel,
  createdAt,
  updatedAt,
  messages,
}: {
  assistantId: string;
  sourceLabel: string;
  visitorLabel: string;
  createdAt: Date;
  updatedAt: Date;
  messages: TranscriptMessage[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={`/dashboard/assistants/${assistantId}/conversations`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Conversations
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Transcript</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {sourceLabel} · {visitorLabel}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Started {formatTimestamp(createdAt)} · Updated {formatTimestamp(updatedAt)}
          </p>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
          <p className="text-sm font-medium">No messages in this conversation</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
          {messages.map((message) => {
            const helpful = feedbackLabel(message.feedback);
            const isUser = message.role === "user";

            return (
              <div
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl px-4 py-3",
                    isUser
                      ? "rounded-tr-md bg-primary text-primary-foreground"
                      : "rounded-tl-md border border-border bg-background",
                  )}
                >
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
                        {helpful ? <span>{helpful}</span> : null}
                        <span>{formatTimestamp(message.createdAt)}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
