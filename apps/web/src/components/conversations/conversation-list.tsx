"use client";

import type { MessageOutcome } from "@chatai/database";
import Link from "next/link";

import { OutcomeBadge } from "@/components/chat/outcome-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  groupConversationsByDay,
  type ConversationListItem,
} from "@/lib/conversation-list";
import { cn } from "@/lib/utils";

export type ConversationListItemDto = Omit<ConversationListItem, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const FAILURE_OUTCOMES = new Set<MessageOutcome>([
  "retrieval_failure",
  "model_failure",
  "processing_failure",
]);

function isFailureOutcome(outcome: MessageOutcome | null | undefined): outcome is MessageOutcome {
  return Boolean(outcome && FAILURE_OUTCOMES.has(outcome));
}

function toListItems(items: ConversationListItemDto[]): ConversationListItem[] {
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
  items,
}: {
  assistantId: string;
  items: ConversationListItemDto[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Conversations"
        description="Chats from the playground, widget, and API."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Chats from the playground, widget, and API will appear here."
        />
      ) : (
        <ConversationGroups assistantId={assistantId} items={items} />
      )}
    </div>
  );
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
                      </p>
                    </div>
                    {failed && item.outcome ? (
                      <Badge variant="danger" className="shrink-0">
                        {outcomeFailureLabel(item.outcome)}
                      </Badge>
                    ) : item.outcome ? (
                      <OutcomeBadge outcome={item.outcome} />
                    ) : null}
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
