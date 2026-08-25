import type { PrivacySettings } from "@chatai/database";
import { defaultPrivacySettings } from "@chatai/database";

export type ResolvedPrivacyPolicy = {
  storeConversations: boolean;
  retentionDays: (typeof defaultPrivacySettings)["retentionDays"];
  anonymizeVisitorIds: boolean;
};

export function resolvePrivacyPolicy(
  settings: PrivacySettings | null | undefined,
): ResolvedPrivacyPolicy {
  return {
    ...defaultPrivacySettings,
    ...settings,
  };
}
