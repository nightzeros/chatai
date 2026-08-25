import type { MessageSource } from "@chatai/database";

import type { TranscriptMessage } from "@/lib/conversation-list";

/**
 * Explicit conversation export shape — never a raw DB row dump.
 * Excludes secrets, debug internals with model provider keys, etc.
 */
export type ConversationExportJson = {
  exportedAt: string;
  conversation: {
    id: string;
    assistantId: string;
    source: string;
    visitorId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    sources: MessageSource[];
    outcome: string | null;
    feedback: string | null;
    confidence: number | null;
    createdAt: string;
  }>;
};

export function buildConversationExport(input: {
  assistantId: string;
  conversation: {
    id: string;
    source: string;
    visitorId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  messages: TranscriptMessage[];
  now?: Date;
}): ConversationExportJson {
  return {
    exportedAt: (input.now ?? new Date()).toISOString(),
    conversation: {
      id: input.conversation.id,
      assistantId: input.assistantId,
      source: input.conversation.source,
      visitorId: input.conversation.visitorId,
      createdAt: input.conversation.createdAt.toISOString(),
      updatedAt: input.conversation.updatedAt.toISOString(),
    },
    messages: input.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sources: message.sources ?? [],
      outcome: message.outcome ?? null,
      feedback: message.feedback ?? null,
      confidence: message.confidence ?? null,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}
