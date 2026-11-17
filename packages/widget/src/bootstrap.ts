import {
  resolveApiUrl,
  VOICE_EXPERIENCES,
  type VoiceAppearance,
  type VoiceExperience,
  type WidgetControllerOptions,
} from "@nightzeros/chatai-widget-core";

type ScriptOptions = Pick<WidgetControllerOptions, "assistantId" | "apiUrl" | "signEndpoint"> & {
  theme?: "light" | "dark" | "system";
  position?: "bottom-left" | "bottom-right";
  /** `data-voice="off"` hides Voice even when the assistant offers it. */
  voice?: boolean;
  voiceAppearance?: VoiceAppearance;
};

function option<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function voiceAppearanceFromScript(script: HTMLScriptElement): VoiceAppearance | undefined {
  const experience = option(script.dataset.voiceExperience, VOICE_EXPERIENCES);
  const captions = script.dataset.voiceCaptions;
  const captionsDefault =
    captions === "on" ? true : captions === "off" ? false : undefined;
  if (experience === undefined && captionsDefault === undefined) return undefined;
  return {
    ...(experience !== undefined ? { experience: experience as VoiceExperience } : {}),
    ...(captionsDefault !== undefined ? { captionsDefault } : {}),
  };
}

export function optionsFromScript(script: HTMLScriptElement): ScriptOptions {
  const assistantId = script.dataset.assistantId?.trim();
  if (!assistantId) {
    throw new Error("ChatAI widget requires data-assistant-id.");
  }

  const apiUrl = resolveApiUrl(script.dataset.apiUrl ?? script.src);
  const signEndpoint = script.dataset.signEndpoint?.trim() || undefined;
  const voiceAppearance = voiceAppearanceFromScript(script);

  return {
    assistantId,
    apiUrl,
    ...(signEndpoint ? { signEndpoint } : {}),
    theme: option(script.dataset.theme, ["light", "dark", "system"] as const),
    position: option(script.dataset.position, ["bottom-left", "bottom-right"] as const),
    ...(script.dataset.voice === "off" ? { voice: false } : {}),
    ...(voiceAppearance ? { voiceAppearance } : {}),
  };
}
