type ChatSource = "playground" | "widget" | "api";

type MetaPayload = {
  messageId: string;
  conversationId: string;
  sources: unknown[];
  confidence: number;
  outcome: string;
  debug: unknown;
};

/** Internal outcomes that visitors (widget, API) must never see. */
const VISITOR_OUTCOME: Record<string, string> = {
  out_of_scope: "conversational",
};

export function publicChatMeta(meta: MetaPayload, source: ChatSource, includeDebug = false) {
  const base = {
    type: "meta" as const,
    messageId: meta.messageId,
    conversationId: meta.conversationId,
    sources: meta.sources,
    confidence: meta.confidence,
    outcome: source === "playground" ? meta.outcome : (VISITOR_OUTCOME[meta.outcome] ?? meta.outcome),
  };

  return source === "playground" && includeDebug ? { ...base, debug: meta.debug } : base;
}
