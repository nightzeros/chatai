import Link from "next/link";

import { MessageBubble, formatTimestamp } from "@/components/conversations/message-bubble";
import { RecordingPlaybackScope } from "@/components/conversations/recording-playback-scope";
import { VoiceCallBlock } from "@/components/conversations/voice-call-block";
import { VoiceTurnDetailsPanel } from "@/components/conversations/voice-turn-details";
import type { TimelineEntry } from "@/lib/conversation-timeline";

export function ConversationTranscript({
  assistantId,
  sourceLabel,
  visitorLabel,
  createdAt,
  updatedAt,
  entries,
}: {
  assistantId: string;
  sourceLabel: string;
  visitorLabel: string;
  createdAt: Date;
  updatedAt: Date;
  entries: TimelineEntry[];
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

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
          <p className="text-sm font-medium">No messages in this conversation</p>
        </div>
      ) : (
        <RecordingPlaybackScope>
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
            {entries.map((entry) =>
              entry.kind === "call" ? (
                <VoiceCallBlock key={`call:${entry.call.id}`} assistantId={assistantId} entry={entry} />
              ) : (
                <MessageBubble key={entry.message.id} message={entry.message}>
                  {entry.message.voiceDetails ? (
                    <VoiceTurnDetailsPanel
                      details={entry.message.voiceDetails}
                      sourceCount={entry.message.sources.length}
                    />
                  ) : null}
                </MessageBubble>
              ),
            )}
          </div>
        </RecordingPlaybackScope>
      )}
    </div>
  );
}
