import { resolveApiUrl, type WidgetControllerOptions } from "@nightzeros/chatai-widget-core";

type ScriptOptions = Pick<WidgetControllerOptions, "assistantId" | "apiUrl" | "signEndpoint"> & {
  theme?: "light" | "dark" | "system";
  position?: "bottom-left" | "bottom-right";
};

function option<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function optionsFromScript(script: HTMLScriptElement): ScriptOptions {
  const assistantId = script.dataset.assistantId?.trim();
  if (!assistantId) {
    throw new Error("ChatAI widget requires data-assistant-id.");
  }

  const apiUrl = resolveApiUrl(script.dataset.apiUrl ?? script.src);
  const signEndpoint = script.dataset.signEndpoint?.trim() || undefined;

  return {
    assistantId,
    apiUrl,
    ...(signEndpoint ? { signEndpoint } : {}),
    theme: option(script.dataset.theme, ["light", "dark", "system"] as const),
    position: option(script.dataset.position, ["bottom-left", "bottom-right"] as const),
  };
}
