import type { ConversationSource } from "@chatai/database";

import { getSession } from "@/lib/session";

/**
 * `source: "playground"` skips widget SecurityPolicy (domain/rate/bot/HMAC).
 * For Voice — which spends provider minutes at mint — the claim must be backed
 * by the assistant owner's dashboard session; otherwise anyone could spoof
 * `playground` to bypass the domain allowlist and widget signing.
 */
export async function assertPlaygroundOwner(input: {
  source: ConversationSource;
  assistantOwnerId: string;
}): Promise<{ ok: true } | { ok: false; status: 403; error: string }> {
  if (input.source !== "playground") return { ok: true };
  const session = await getSession();
  if (session?.user.id === input.assistantOwnerId) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: "Playground voice sessions require the assistant owner session.",
  };
}
