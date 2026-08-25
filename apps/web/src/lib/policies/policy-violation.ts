export type PolicyViolation = {
  status: 403 | 429;
  /** Safe to return to the client. */
  message: string;
  headers?: Record<string, string>;
  /** Server-only diagnostic; do not expose to clients. */
  reason: string;
};

export type WidgetRequestContext = {
  visitorId?: string | null;
  message?: string;
  source?: "playground" | "widget" | "api";
  /** Sign endpoint issues signatures — do not require one on that request. */
  skipSignatureCheck?: boolean;
};
