import type { SecuritySettings } from "@chatai/database";

type AssistantLike = {
  securitySettings?: SecuritySettings | null;
};

/**
 * Strip signing secrets before passing an assistant into a Client Component.
 * Next.js serializes client props to the browser; the HMAC secret must stay server-side
 * except for the intentional one-time reveal from `updateWidgetSigning`.
 */
export function redactAssistantForClient<T extends AssistantLike>(assistant: T): T {
  const secret = assistant.securitySettings?.widgetSigningSecret;
  if (!secret) {
    return assistant;
  }

  return {
    ...assistant,
    securitySettings: {
      ...assistant.securitySettings,
      widgetSigningSecret: null,
    },
  };
}
