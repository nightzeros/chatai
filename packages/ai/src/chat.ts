import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";

export type ChatConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
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

function provider(config: ChatConfig) {
  requireKey(config);
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

export function streamChat(opts: {
  config: ChatConfig;
  system: string;
  messages: ChatMessage[];
}): { textStream: AsyncIterable<string> } {
  const openai = provider(opts.config);
  const result = streamText({
    model: openai.chat(opts.config.model),
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
  const openai = provider(opts.config);
  const result = await generateText({
    model: openai.chat(opts.config.model),
    system: opts.system,
    prompt: opts.prompt,
  });
  return result.text.trim();
}
