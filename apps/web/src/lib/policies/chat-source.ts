import type { ConversationSource } from "@chatai/database";

/**
 * The request body's `source` is only a claim. Playground behavior (no widget
 * SecurityPolicy, always-persist, usage exemption, owner outcomes and debug) requires
 * the assistant owner's dashboard session; anyone else claiming it is a widget
 * visitor. API-key calls are integrations, never the Playground.
 */
export function resolveChatSource(input: {
  claimed?: ConversationSource;
  apiKey: boolean;
  ownerSession: boolean;
}): ConversationSource {
  const claimed = input.claimed ?? "api";
  if (claimed !== "playground") return claimed;
  if (input.apiKey) return "api";
  return input.ownerSession ? "playground" : "widget";
}

/** Keyless callers other than the verified owner: never shown plan, allowance or account state. */
export function isPublicVisitor(input: { apiKey: boolean; source: ConversationSource }): boolean {
  return !input.apiKey && input.source !== "playground";
}

/** The one refusal visitors see when the owner's account cannot serve them right now. */
export const VISITOR_UNAVAILABLE_MESSAGE = "This assistant isn't available right now. Please try again later.";
