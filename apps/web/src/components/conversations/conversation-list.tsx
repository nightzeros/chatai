"use client";

import Link from "next/link";

import { OutcomeBadge } from "@/components/chat/outcome-badge";
import {
  groupConversationsByDay,
  type ConversationListItem,
} from "@/lib/conversation-list";
import { cn } from "@/lib/utils";

export type ConversationListItemDto = Omit<ConversationListItem, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

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
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Chats from the playground, widget, and API will appear here.
        </p>
      </div>
    );
  }

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
            {group.items.map((item, index) => (
              <li key={item.id} className={cn(index > 0 ? "border-t border-border" : null)}>
                <Link
                  href={`/dashboard/assistants/${assistantId}/conversations/${item.id}`}
                  className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.preview}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {item.sourceLabel} · {item.visitorLabel} · {formatTime(item.updatedAt)} · {item.messageCount}{" "}
                      {item.messageCount === 1 ? "message" : "messages"}
                    </p>
                  </div>
                  {item.outcome ? <OutcomeBadge outcome={item.outcome} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
