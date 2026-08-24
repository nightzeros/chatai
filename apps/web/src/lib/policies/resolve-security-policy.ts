import type { SecuritySettings } from "@chatai/database";
import { defaultSecuritySettings } from "@chatai/database";

import type { Env } from "@/lib/env";

export type ResolvedSecurityPolicy = {
  allowedDomains: string[];
  requireWidgetSigning: boolean;
  widgetSigningSecret: string | null;
  widgetRateLimitPerVisitor: number;
  widgetRateLimitPerAssistant: number;
  signingMaxSkewSeconds: number;
};

export type SecurityPolicyEnv = Pick<
  Env,
  | "WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE"
  | "WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE"
  | "WIDGET_SIGNING_MAX_SKEW_SECONDS"
>;

export function resolveSecurityPolicy(
  settings: SecuritySettings | null | undefined,
  env: SecurityPolicyEnv,
): ResolvedSecurityPolicy {
  const merged = {
    ...defaultSecuritySettings,
    ...settings,
    allowedDomains: settings?.allowedDomains ?? defaultSecuritySettings.allowedDomains,
  };

  return {
    allowedDomains: merged.allowedDomains,
    requireWidgetSigning: merged.requireWidgetSigning,
    widgetSigningSecret: merged.widgetSigningSecret ?? null,
    widgetRateLimitPerVisitor:
      merged.widgetRateLimitPerVisitor ?? env.WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE,
    widgetRateLimitPerAssistant:
      merged.widgetRateLimitPerAssistant ?? env.WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE,
    signingMaxSkewSeconds: env.WIDGET_SIGNING_MAX_SKEW_SECONDS,
  };
}
