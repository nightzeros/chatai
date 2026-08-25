export type SecuritySettings = {
  /** Hostnames only, e.g. "example.com", "*.vercel.app". Empty = allow all. */
  allowedDomains?: string[];
  requireWidgetSigning?: boolean;
  /** Auto-generated when signing enabled; never returned to client in full. */
  widgetSigningSecret?: string | null;
  /** null = use instance env default */
  widgetRateLimitPerVisitor?: number | null;
  /** null = use instance env default */
  widgetRateLimitPerAssistant?: number | null;
};

export const defaultSecuritySettings: Required<Omit<SecuritySettings, "widgetSigningSecret">> & {
  widgetSigningSecret: null;
} = {
  allowedDomains: [],
  requireWidgetSigning: false,
  widgetSigningSecret: null,
  widgetRateLimitPerVisitor: null,
  widgetRateLimitPerAssistant: null,
};
