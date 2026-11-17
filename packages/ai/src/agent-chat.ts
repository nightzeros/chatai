import { generateText, jsonSchema, stepCountIs, tool, type ToolSet } from "ai";

import { createChatLanguageModel } from "./models";
import type { ChatConfig, ChatMessage } from "./chat";
import {
  emptyProviderUsage,
  normalizeLanguageModelUsage,
  type ProviderUsage,
} from "./usage";

export type AgentToolDefinition = {
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

export type GenerateAgentTextResult = {
  text: string;
  usage: ProviderUsage;
  /** Per-step usage from the multi-step loop (including tool rounds). */
  stepUsages: Array<{ step: string; usage: ProviderUsage }>;
  steps: number;
};

/**
 * Multi-step tool-calling completion for the shared assistant agent.
 * Caller owns tool side effects, cancellation, and billing aggregation.
 */
export async function generateAgentText(opts: {
  config: ChatConfig;
  system: string;
  messages: ChatMessage[];
  tools: Record<string, AgentToolDefinition>;
  /** Max model steps (each may include tool calls). Default 6. */
  maxSteps?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<GenerateAgentTextResult> {
  if (!opts.config.apiKey) {
    throw new Error("AI_API_KEY is required to generate chat completions.");
  }

  const tools: ToolSet = {};
  for (const [name, def] of Object.entries(opts.tools)) {
    tools[name] = tool({
      description: def.description,
      // Tool schemas are plain JSON Schema objects built by callers.
      inputSchema: jsonSchema(def.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input) => def.execute(input as Record<string, unknown>),
    });
  }

  const result = await generateText({
    model: createChatLanguageModel(opts.config),
    system: opts.system,
    messages: opts.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    tools,
    stopWhen: stepCountIs(opts.maxSteps ?? 6),
    ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
  });

  const stepUsages = (result.steps ?? []).map((step, index) => ({
    step: `agent_step_${index + 1}`,
    usage: normalizeLanguageModelUsage(step.usage),
  }));

  return {
    text: result.text ?? "",
    usage: normalizeLanguageModelUsage(result.usage) ?? emptyProviderUsage(),
    stepUsages,
    steps: result.steps?.length ?? 0,
  };
}

export { stepCountIs, tool, jsonSchema };
