import type { DecryptedProviderSecrets } from "@/lib/secrets/provider-secrets";
import type { UsageBillingMode } from "@chatai/database";

export type BillingModeKind = "chat" | "embedding" | "rerank";

/**
 * Hosted = NightZeros instance provider key (counts against hosted budget).
 * BYOK = per-assistant customer key for that provider (meter for visibility; exclude from hosted budget later).
 *
 * Cohere rerank currently always uses the instance `COHERE_API_KEY` → hosted.
 */
export function resolveBillingMode(input: {
  kind: BillingModeKind;
  provider?: string | null;
  secrets?: DecryptedProviderSecrets;
}): UsageBillingMode {
  const provider = input.provider?.trim();
  if (!provider) {
    return "hosted";
  }

  if (input.kind === "rerank") {
    return "hosted";
  }

  if (input.kind === "chat" && input.secrets?.chat?.provider === provider) {
    return "byok";
  }

  if (input.kind === "embedding" && input.secrets?.embedding?.provider === provider) {
    return "byok";
  }

  return "hosted";
}
