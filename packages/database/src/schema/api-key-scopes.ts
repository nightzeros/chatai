export const API_KEY_SCOPES = [
  "chat",
  "assistants:read",
  "assistants:write",
  "documents:read",
  "documents:write",
  "conversations:read",
  "analytics:read",
  /** Realtime Voice session mint/end. Not implied by `chat`. */
  "voice",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
