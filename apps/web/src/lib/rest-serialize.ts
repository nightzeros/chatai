import type { Assistant } from "@/lib/assistants";
import type { Document } from "@/lib/documents";

/** Owner REST shape — never includes securitySettings (widget signing secret) or privacySettings. */
export function serializeAssistant(assistant: Assistant) {
  return {
    id: assistant.id,
    publicId: assistant.publicId,
    name: assistant.name,
    description: assistant.description,
    welcomeMessage: assistant.welcomeMessage,
    instructions: assistant.instructions,
    hallucinationMode: assistant.hallucinationMode,
    settings: assistant.settings,
    ragSettings: assistant.ragSettings,
    modelSettings: assistant.modelSettings,
    createdAt: assistant.createdAt,
    updatedAt: assistant.updatedAt,
  };
}

export function serializeDocument(document: Document) {
  return {
    id: document.id,
    assistantId: document.assistantId,
    type: document.type,
    name: document.name,
    mimeType: document.mimeType,
    status: document.status,
    error: document.error,
    chunkCount: document.chunkCount,
    excluded: document.excluded,
    url: document.url,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
