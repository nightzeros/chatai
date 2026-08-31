import { assistantCreateSchema, assistantPatchSchema } from "@nightzeros/chatai-sdk";

export const DEFAULT_WELCOME = "Hi! How can I help you today?";
export const DEFAULT_INSTRUCTIONS =
  "You are a helpful AI assistant. Answer questions using the supplied knowledge base. Do not make up information.";

export { assistantCreateSchema, assistantPatchSchema };

function emptyToNull(value: string | null | undefined) {
  if (value == null) return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeAssistantWrite<T extends { description?: string | null; instructions?: string | null }>(
  data: T,
) {
  return {
    ...data,
    description: data.description === undefined ? undefined : emptyToNull(data.description),
    instructions: data.instructions === undefined ? undefined : emptyToNull(data.instructions),
  };
}
