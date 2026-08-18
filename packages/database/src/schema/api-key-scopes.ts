export const API_KEY_SCOPES = [
  "chat",
  "assistants:read",
  "assistants:write",
  "documents:read",
  "documents:write",
  "conversations:read",
  "analytics:read",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
