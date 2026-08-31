import type { ChatWidgetOptions } from "@nightzeros/chatai-react";

import type { AssistantSettingsInput } from "@/lib/assistant-settings";

type PreviewWidgetInput = {
  assistantId: string;
  apiUrl: string;
  settings: AssistantSettingsInput;
};

const previewStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem() {
    return null;
  },
  setItem() {},
  removeItem() {},
};

export function previewWidgetOptions(input: PreviewWidgetInput): ChatWidgetOptions {
  return {
    assistantId: input.assistantId,
    apiUrl: input.apiUrl,
    ...input.settings,
    layout: "contained",
    storage: previewStorage,
  };
}
