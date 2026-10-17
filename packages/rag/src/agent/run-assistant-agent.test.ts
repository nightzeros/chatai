import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@chatai/ai", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateAgentText: vi.fn(),
  };
});

vi.mock("../answer/profile", () => ({
  loadAssistantContext: vi.fn(async () => ({
    purpose: null,
    facts: [],
    overviewClaims: [],
    overview: null,
    version: 1,
  })),
}));

vi.mock("./search-knowledge", () => ({
  searchKnowledgeToolDefinition: (opts: {
    onPassages: (
      passages: Array<{ id: string; documentId: string; chunkId: string; title: string; text: string; score: number }>,
      chunks: Array<{
        chunkId: string;
        documentId: string;
        documentName: string;
        content: string;
        similarity: number;
      }>,
    ) => void;
  }) => ({
    description: "search",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async () => {
      opts.onPassages(
        [{ id: "1", documentId: "d1", chunkId: "c1", title: "Doc", text: "Built a booking app.", score: 0.9 }],
        [
          {
            chunkId: "c1",
            documentId: "d1",
            documentName: "Doc",
            content: "Built a booking app.",
            similarity: 0.9,
          },
        ],
      );
      return {
        passages: [{ id: "1", documentId: "d1", chunkId: "c1", title: "Doc", text: "Built a booking app.", score: 0.9 }],
        meta: { retrieveMs: 1 },
      };
    },
  }),
}));

import { generateAgentText } from "@chatai/ai";

import { runAssistantAgent } from "./run-assistant-agent";

const chat = { provider: "openai", model: "gpt-4o-mini", apiKey: "k", baseURL: "https://api.openai.com/v1" };
const embedding = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "k",
  baseURL: "https://api.openai.com/v1",
  dimensions: 1536,
};

const emptyUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };

describe("runAssistantAgent", () => {
  beforeEach(() => {
    vi.mocked(generateAgentText).mockReset();
  });

  it("returns agent answer with sources and usage event ids", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "overview" });
      return {
        text: "They built a booking app [1].",
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, totalTokens: 15 },
        stepUsages: [
          {
            step: "agent_step_1",
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, totalTokens: 15 },
          },
        ],
        steps: 2,
      };
    });

    const accrued: string[] = [];
    const result = await runAssistantAgent({
      turnId: "trn_1",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me about him",
      history: [],
      chat,
      embedding,
      onUsage: (record) => accrued.push(record.eventId ?? ""),
      deps: {
        verifyAgentSemanticSupport: async () => ({
          passed: true,
          unavailable: false,
          reason: "ok",
          usage: emptyUsage,
        }),
        checkPurpose: async () => ({
          decision: "in_scope",
          confidence: "high",
          rationale: "portfolio",
          usage: emptyUsage,
          unavailable: false,
        }),
      },
    });

    expect(result.answer).toContain("booking app");
    expect(result.sources[0]?.documentId).toBe("d1");
    expect(result.turnSnapshot.answerOwner).toBe("agent");
    expect(accrued).toContain("trn_1:agent_step_1");
    expect(generateAgentText).toHaveBeenCalledOnce();
  });

  it("replaces answers with invalid citations", async () => {
    vi.mocked(generateAgentText).mockResolvedValue({
      text: "Secret claim [9].",
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
      stepUsages: [],
      steps: 1,
    });

    const result = await runAssistantAgent({
      turnId: "trn_2",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me a secret",
      history: [],
      chat,
      embedding,
      deps: {
        verifyAgentSemanticSupport: async () => ({
          passed: true,
          unavailable: false,
          reason: "skipped",
          usage: emptyUsage,
        }),
        checkPurpose: async () => ({
          decision: "in_scope",
          confidence: "high",
          rationale: "ok",
          usage: emptyUsage,
          unavailable: false,
        }),
      },
    });

    expect(result.answer).toMatch(/verified sources/i);
    expect(result.sources).toEqual([]);
  });

  it("fail-closes when semantic verification is unavailable", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "overview" });
      return {
        text: "They built a booking app [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "trn_4",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me about him",
      history: [],
      chat,
      embedding,
      deps: {
        verifyAgentSemanticSupport: async () => ({
          passed: false,
          unavailable: true,
          reason: "Verifier unavailable.",
          usage: emptyUsage,
        }),
        checkPurpose: async () => ({
          decision: "in_scope",
          confidence: "high",
          rationale: "ok",
          usage: emptyUsage,
          unavailable: false,
        }),
      },
    });

    expect(result.answer).toMatch(/verified sources/i);
  });

  it("replaces out-of-scope drafts with a domain limitation", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "cake" });
      return {
        text: "Here is a cake recipe [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "trn_5",
      db: {} as never,
      assistantId: "asst_1",
      message: "Help me bake a cake",
      history: [],
      chat,
      embedding,
      deps: {
        verifyAgentSemanticSupport: async () => ({
          passed: true,
          unavailable: false,
          reason: "ok",
          usage: emptyUsage,
        }),
        checkPurpose: async () => ({
          decision: "out_of_scope",
          confidence: "high",
          rationale: "cooking",
          usage: emptyUsage,
          unavailable: false,
        }),
      },
    });

    expect(result.answer).not.toMatch(/cake recipe/i);
    expect(result.answer).not.toMatch(/feel free to ask/i);
  });

  it("fails closed for incompatible providers", async () => {
    await expect(
      runAssistantAgent({
        turnId: "trn_3",
        db: {} as never,
        assistantId: "asst_1",
        message: "Hi",
        history: [],
        chat: { ...chat, provider: "ollama", model: "llama3" },
        embedding,
      }),
    ).rejects.toMatchObject({ code: "agent_model_incompatible" });
  });
});
