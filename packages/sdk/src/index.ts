export { ChatAI, type ChatAIOptions, type ChatInput, type ChatResult } from "./client";
export { ChatAIError } from "./errors";
export { getOpenApiDocument } from "./openapi";
export {
  assistantCreateSchema,
  assistantPatchSchema,
  chatRequestSchema,
  type Assistant,
  type AssistantCreateInput,
  type AssistantPatchInput,
  type ChatRequestInput,
  type Document,
} from "./schemas";
export type { ChatStreamEvent } from "./sse";
export { API_VERSION } from "./version";
