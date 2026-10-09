export { ChatAI, type ChatAIOptions, type ChatInput, type ChatResult } from "./client";
export { ChatAIError } from "./errors";
export { getOpenApiDocument } from "./openapi";
export {
  assistantCreateSchema,
  assistantPatchSchema,
  chatRequestSchema,
  voiceSessionCreateRequestSchema,
  voiceSessionCreateResponseSchema,
  voiceSessionEndRequestSchema,
  voiceSessionEndResponseSchema,
  voiceSessionGateEventSchema,
  voiceSessionGateRequestSchema,
  voiceSessionHeartbeatRequestSchema,
  voiceSessionHeartbeatResponseSchema,
  voiceSessionRefusalSchema,
  type Assistant,
  type AssistantCreateInput,
  type AssistantPatchInput,
  type ChatRequestInput,
  type Document,
  type VoiceSessionCreateInput,
  type VoiceSessionEndInput,
} from "./schemas";
export type { ChatStreamEvent } from "./sse";
export { API_VERSION } from "./version";
