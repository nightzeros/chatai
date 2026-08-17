type ChatSource = "playground" | "widget" | "api";

type MetaPayload = {
  messageId: string;
  conversationId: string;
  sources: unknown[];
  confidence: number;
  outcome: string;
  debug: unknown;
};

export function publicChatMeta(meta: MetaPayload, source: ChatSource, includeDebug = false) {
  const base = {
    type: "meta" as const,
    messageId: meta.messageId,
    conversationId: meta.conversationId,
    sources: meta.sources,
    confidence: meta.confidence,
    outcome: meta.outcome,
  };

  return source === "playground" && includeDebug ? { ...base, debug: meta.debug } : base;
}
