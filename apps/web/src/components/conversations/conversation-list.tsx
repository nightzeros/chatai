"use client";

import type { MessageOutcome } from "@chatai/database";
import { Mic } from "lucide-react";
import Link from "next/link";

import { OutcomeBadge } from "@/components/chat/outcome-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  groupConversationsByDay,
  type ConversationKind,
  type ConversationReviewListItem,
  type ConversationTypeFilter,
} from "@/lib/conversation-list";
import { formatVoiceDuration } from "@/lib/voice/duration-format";
import { cn } from "@/lib/utils";

export type ConversationListItemDto = Omit<ConversationReviewListItem, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const FAILURE_OUTCOMES = new Set<MessageOutcome>([
  "retrieval_failure",
  "model_failure",
  "processing_failure",
]);

const FILTERS: Array<{ value: ConversationTypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "text", label: "Text" },
  { value: "voice", label: "Voice" },
];

const KIND_LABEL: Record<ConversationKind, string> = {
  text: "Text",
  voice: "Voice",
  mixed: "Mixed",
};

const EMPTY_COPY: Record<ConversationTypeFilter, { title: string; description: string }> = {
  all: {
    title: "No conversations yet",
    description: "Chats from the playground, widget, and API will appear here.",
  },
  text: {
    title: "No text-only conversations",
    description: "Conversations without any Voice call will appear here.",
  },
  voice: {
    title: "No Voice conversations",
    description: "Conversations with a Voice call (including mixed text and Voice) will appear here.",
  },
};

function isFailureOutcome(outcome: MessageOutcome | null | undefined): outcome is MessageOutcome {
  return Boolean(outcome && FAILURE_OUTCOMES.has(outcome));
}

function toListItems(items: ConversationListItemDto[]): ConversationReviewListItem[] {
  return items.map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
  }));
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ConversationList({
  assistantId,
  filter,
  items,
}: {
  assistantId: string;
  filter: ConversationTypeFilter;
  items: ConversationListItemDto[];
}) {
  const empty = EMPTY_COPY[filter];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Conversations"
        description="Chats from the playground, widget, and API."
      />

      <nav aria-label="Filter conversations" className="flex gap-1 self-start rounded-lg border border-border p-1">
        {FILTERS.map((option) => (
          <Link
            key={option.value}
            href={
              option.value === "all"
                ? `/dashboard/assistants/${assistantId}/conversations`
                : `/dashboard/assistants/${assistantId}/conversations?type=${option.value}`
            }
            aria-current={filter === option.value ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              filter === option.value
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <ConversationGroups assistantId={assistantId} items={items} />
      )}
    </div>
  );
}

function voiceMeta(item: ConversationReviewListItem): string | null {
  const { voiceCallCount, voiceDurationMs } = item.voice;
  if (voiceCallCount === 0) return null;
  const calls = `${voiceCallCount} ${voiceCallCount === 1 ? "call" : "calls"}`;
  return voiceDurationMs > 0 ? `${calls} (${formatVoiceDuration(voiceDurationMs / 1000)})` : calls;
}

function ConversationGroups({
  assistantId,
  items,
}: {
  assistantId: string;
  items: ConversationListItemDto[];
}) {
  const groups = groupConversationsByDay(
    toListItems(items),
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.label}</h2>
          <ul className="overflow-hidden rounded-xl border border-border">
            {group.items.map((item, index) => {
              const failed = isFailureOutcome(item.outcome);
              const calls = voiceMeta(item);
              return (
                <li
                  key={item.id}
                  className={cn(
                    index > 0 ? "border-t border-border" : null,
                    failed ? "border-l-2 border-l-destructive bg-destructive/5" : null,
                  )}
                >
                  <Link
                    href={`/dashboard/assistants/${assistantId}/conversations/${item.id}`}
                    className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium sm:truncate">{item.preview}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:truncate">
                        {item.sourceLabel} · {item.visitorLabel} · {formatTime(item.updatedAt)} ·{" "}
                        {item.messageCount} {item.messageCount === 1 ? "message" : "messages"}
                        {calls ? ` · ${calls}` : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.voice.recordingCount > 0 ? (
                        <Mic className="size-3.5 text-muted-foreground" aria-label="Has a Voice recording" />
                      ) : null}
                      <Badge variant={item.voice.kind === "text" ? "outline" : "info"}>
                        {KIND_LABEL[item.voice.kind]}
                      </Badge>
                      {failed && item.outcome ? (
                        <Badge variant="danger">{outcomeFailureLabel(item.outcome)}</Badge>
                      ) : item.outcome ? (
                        <OutcomeBadge outcome={item.outcome} />
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function outcomeFailureLabel(outcome: MessageOutcome) {
  if (outcome === "retrieval_failure") return "Retrieval failed";
  if (outcome === "model_failure") return "Model failed";
  return "Processing failed";
}
