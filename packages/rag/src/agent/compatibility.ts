import type { ChatConfig } from "@chatai/ai";

/** Providers with verified AI SDK tool-calling support for the shared agent. */
const AGENT_TOOL_PROVIDERS = new Set([
  "openai",
  "openai-compatible",
  "anthropic",
  "google",
  "openrouter",
  "groq",
  "azure",
]);

export type AgentCompatibility =
  | { ok: true }
  | { ok: false; code: "agent_model_incompatible"; error: string };

/**
 * Fail closed: do not silently substitute another model or provider.
 * Ollama and unknown providers are unsupported until the compatibility matrix expands.
 */
export function assertAgentCompatible(chat: ChatConfig): AgentCompatibility {
  const provider = (chat.provider ?? "openai").toLowerCase();
  if (!AGENT_TOOL_PROVIDERS.has(provider)) {
    return {
      ok: false,
      code: "agent_model_incompatible",
      error: `The configured chat provider "${provider}" is not enabled for the tool-calling agent. Switch the assistant chat model to a supported provider, or keep ANSWER_OWNER_TEXT=legacy.`,
    };
  }
  if (!chat.model?.trim()) {
    return {
      ok: false,
      code: "agent_model_incompatible",
      error: "The assistant has no chat model configured for the tool-calling agent.",
    };
  }
  return { ok: true };
}
