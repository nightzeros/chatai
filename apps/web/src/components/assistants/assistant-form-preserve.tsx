import { defaultRagSettings } from "@chatai/database/rag-settings";

import type { Assistant } from "@/lib/assistants";

type Preserve = "identity" | "retrieval" | "models";

/**
 * Hidden inputs so `updateAssistant` still receives full assistant state when a
 * partial settings form is submitted.
 */
export function AssistantFormPreserve({
  assistant,
  omit,
}: {
  assistant: Assistant;
  omit: Preserve;
}) {
  const model = assistant.modelSettings ?? {};
  const rag = {
    ...defaultRagSettings,
    ...assistant.ragSettings,
    guardrails: {
      ...defaultRagSettings.guardrails,
      ...assistant.ragSettings?.guardrails,
    },
  };

  return (
    <>
      {omit !== "identity" ? (
        <>
          <input type="hidden" name="name" value={assistant.name} />
          <input type="hidden" name="description" value={assistant.description ?? ""} />
          <input type="hidden" name="welcomeMessage" value={assistant.welcomeMessage} />
          <input type="hidden" name="instructions" value={assistant.instructions ?? ""} />
          <input type="hidden" name="hallucinationMode" value={assistant.hallucinationMode} />
        </>
      ) : null}
      {omit !== "retrieval" ? (
        <>
          <input type="hidden" name="chunkingMode" value={rag.chunkingMode} />
          <input type="hidden" name="evalSampleRate" value={rag.evalSampleRate} />
          {rag.hybridSearch ? <input type="hidden" name="hybridSearch" value="on" /> : null}
          {rag.rerank ? <input type="hidden" name="rerank" value="on" /> : null}
          {rag.queryExpansion ? <input type="hidden" name="queryExpansion" value="on" /> : null}
          {rag.guardrails.requireContext ? <input type="hidden" name="requireContext" value="on" /> : null}
          {rag.guardrails.verifyCitations ? (
            <input type="hidden" name="verifyCitations" value="on" />
          ) : null}
          {rag.guardrails.refuseOnLowConfidence ? (
            <input type="hidden" name="refuseOnLowConfidence" value="on" />
          ) : null}
        </>
      ) : null}
      {omit !== "models" ? (
        <>
          <input type="hidden" name="chatProvider" value={model.chatProvider ?? ""} />
          <input type="hidden" name="chatModel" value={model.chatModel ?? ""} />
          <input type="hidden" name="embeddingProvider" value={model.embeddingProvider ?? ""} />
          <input type="hidden" name="embeddingModel" value={model.embeddingModel ?? ""} />
        </>
      ) : null}
    </>
  );
}
