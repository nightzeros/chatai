import { ChatAIError } from "./errors";
import { parseSseStream, type ChatMetaEvent, type ChatStreamEvent } from "./sse";
import type { Assistant, AssistantCreateInput, AssistantPatchInput, Document } from "./schemas";

export type ChatAIOptions = {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
};

export type ChatInput = {
  assistantId: string;
  message: string;
  conversationId?: string;
  visitorId?: string;
  source?: "playground" | "widget" | "api";
  signal?: AbortSignal;
  onToken?: (text: string) => void;
};

export type ChatResult = {
  answer: string;
  conversationId: string;
  messageId?: string;
  sources: unknown[];
  confidence?: number;
  outcome?: string;
};

type Json = Record<string, unknown>;

export class ChatAI {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ChatAIOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("apiKey is required.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listAssistants() {
    const data = await this.request<{ assistants: Assistant[] }>("/api/v1/assistants");
    return data.assistants;
  }

  async getAssistant(assistantId: string) {
    const data = await this.request<{ assistant: Assistant }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}`,
    );
    return data.assistant;
  }

  async createAssistant(body: AssistantCreateInput) {
    const data = await this.request<{ assistant: Assistant }>("/api/v1/assistants", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data.assistant;
  }

  async updateAssistant(assistantId: string, body: AssistantPatchInput) {
    const data = await this.request<{ assistant: Assistant }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    return data.assistant;
  }

  async deleteAssistant(assistantId: string) {
    await this.request<{ ok: true }>(`/api/v1/assistants/${encodeURIComponent(assistantId)}`, {
      method: "DELETE",
    });
  }

  async listDocuments(assistantId: string) {
    const data = await this.request<{ documents: Document[] }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/documents`,
    );
    return data.documents;
  }

  async getDocument(assistantId: string, documentId: string) {
    const data = await this.request<{ document: Document }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/documents/${encodeURIComponent(documentId)}`,
    );
    return data.document;
  }

  async deleteDocument(assistantId: string, documentId: string) {
    await this.request<{ ok: true }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
  }

  async reprocessDocument(assistantId: string, documentId: string) {
    await this.request<{ ok: true }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/documents/${encodeURIComponent(documentId)}/reprocess`,
      { method: "POST" },
    );
  }

  async listConversations(assistantId: string) {
    const data = await this.request<{ conversations: Json[] }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/conversations`,
    );
    return data.conversations;
  }

  async getConversation(assistantId: string, conversationId: string) {
    return this.request<{ conversation: Json; messages: Json[] }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/conversations/${encodeURIComponent(conversationId)}`,
    );
  }

  async getAnalytics(assistantId: string) {
    return this.request<{ metrics: Json; topUnanswered: Json[] }>(
      `/api/v1/assistants/${encodeURIComponent(assistantId)}/analytics`,
    );
  }

  async *streamChat(input: ChatInput): AsyncGenerator<ChatStreamEvent> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: this.headers(true),
      signal: input.signal,
      body: JSON.stringify({
        assistantId: input.assistantId,
        message: input.message,
        conversationId: input.conversationId,
        visitorId: input.visitorId,
        source: input.source ?? "api",
      }),
    });

    if (!response.ok) {
      throw await this.errorFrom(response);
    }
    if (!response.body) {
      throw new ChatAIError("Empty response stream.", 500);
    }

    yield* parseSseStream(response.body);
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    let answer = "";
    let meta: ChatMetaEvent | undefined;

    for await (const event of this.streamChat(input)) {
      if (event.type === "token") {
        answer += event.text;
        input.onToken?.(event.text);
      } else if (event.type === "meta") {
        meta = event;
      }
    }

    return {
      answer,
      conversationId: meta?.conversationId ?? input.conversationId ?? "",
      messageId: meta?.messageId,
      sources: meta?.sources ?? [],
      confidence: meta?.confidence,
      outcome: meta?.outcome,
    };
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const json = typeof init.body === "string";
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(json), ...(init.headers as Record<string, string> | undefined) },
    });

    if (!response.ok) {
      throw await this.errorFrom(response);
    }

    return (await response.json()) as T;
  }

  private async errorFrom(response: Response) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return new ChatAIError(
      data.error ?? `Request failed (${response.status}).`,
      response.status,
      response.headers.get("Retry-After"),
    );
  }
}
