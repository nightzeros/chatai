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

/** `ownerView`: the verified assistant owner in the Playground (never the client's claim). */
export function publicChatMeta(meta: MetaPayload, ownerView = false) {
  const base = {
    type: "meta" as const,
    messageId: meta.messageId,
    conversationId: meta.conversationId,
    sources: meta.sources,
    confidence: meta.confidence,
    outcome: ownerView ? meta.outcome : (VISITOR_OUTCOME[meta.outcome] ?? meta.outcome),
  };

  return ownerView ? { ...base, debug: meta.debug } : base;
}
