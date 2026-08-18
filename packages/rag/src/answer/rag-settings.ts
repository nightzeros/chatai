import type { DocumentType, RagSettings } from "@chatai/database";
import { defaultRagSettings } from "@chatai/database";

export type { RagSettings };

export type ResolvedRagSettings = typeof defaultRagSettings;

export function resolveRagSettings(settings?: RagSettings | null): ResolvedRagSettings {
  return {
    ...defaultRagSettings,
    ...settings,
    guardrails: {
      ...defaultRagSettings.guardrails,
      ...settings?.guardrails,
    },
  };
}

export type RetrieveFilters = {
  documentIds?: string[];
  sourceId?: string;
  documentTypes?: DocumentType[];
};
