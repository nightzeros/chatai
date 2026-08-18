import { generateText, streamText } from "ai";

import { createChatLanguageModel } from "./models";

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

function requireKey(config: ChatConfig) {
  if (!config.apiKey) {
    throw new Error("AI_API_KEY is required to generate chat completions.");
  }
}

export function streamChat(opts: {
  config: ChatConfig;
  system: string;
  messages: ChatMessage[];
}): { textStream: AsyncIterable<string> } {
  requireKey(opts.config);
  const result = streamText({
    model: createChatLanguageModel(opts.config),
    system: opts.system,
    messages: opts.messages,
  });
  return {
    textStream: result.textStream,
  };
}

export async function generateChat(opts: {
  config: ChatConfig;
  system: string;
  prompt: string;
}): Promise<string> {
  requireKey(opts.config);
  const result = await generateText({
    model: createChatLanguageModel(opts.config),
    system: opts.system,
    prompt: opts.prompt,
  });
  return result.text.trim();
}
