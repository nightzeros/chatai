import { generateText, streamText } from "ai";

import { createChatLanguageModel } from "./models";
import {
  asGenerateChatResult,
  emptyProviderUsage,
  normalizeLanguageModelUsage,
  type GenerateChatResult,
  type ProviderUsage,
} from "./usage";

export type ChatConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  provider?: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type { GenerateChatResult, ProviderUsage };

function requireKey(config: ChatConfig) {
  if (!config.apiKey) {
    throw new Error("AI_API_KEY is required to generate chat completions.");
  }
}

export type StreamChatResult = {
  textStream: AsyncIterable<string>;
  /** Resolves when the provider finishes (includes disconnect / abort cases when available). */
  usage: Promise<ProviderUsage>;
};

export function streamChat(opts: {
  config: ChatConfig;
  system: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
}): StreamChatResult {
  requireKey(opts.config);
  const result = streamText({
    model: createChatLanguageModel(opts.config),
    system: opts.system,
    messages: opts.messages,
    ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  });

  const usage = Promise.resolve(result.usage)
    .then((value) => normalizeLanguageModelUsage(value))
    .catch(() => emptyProviderUsage());

  return {
    textStream: result.textStream,
    usage,
  };
}

export async function generateChat(
  opts: {
    config: ChatConfig;
    system: string;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  } & ({ prompt: string; messages?: undefined } | { messages: ChatMessage[]; prompt?: undefined }),
): Promise<GenerateChatResult> {
  requireKey(opts.config);
  const model = createChatLanguageModel(opts.config);
  const common = {
    model,
    system: opts.system,
    ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
  };
  const result = opts.messages
    ? await generateText({ ...common, messages: opts.messages })
    : await generateText({ ...common, prompt: opts.prompt });
  return {
    text: result.text.trim(),
    usage: normalizeLanguageModelUsage(result.usage),
  };
}

/**
 * Dependency injection seam for RAG/evals tests.
 * Accepts either `GenerateChatResult` or a legacy string return.
 */
export type GenerateChatFn = (
  opts: Parameters<typeof generateChat>[0],
) => Promise<GenerateChatResult | string>;

export async function runGenerateChat(
  generate: GenerateChatFn,
  opts: Parameters<typeof generateChat>[0],
): Promise<GenerateChatResult> {
  return asGenerateChatResult(await generate(opts));
}
