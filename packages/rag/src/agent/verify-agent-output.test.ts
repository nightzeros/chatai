import { describe, expect, it, vi } from "vitest";

import { verifyAgentSemanticSupport } from "./verify-agent-output";

const chat = { provider: "openai", model: "gpt", apiKey: "k", baseURL: "https://api.openai.com/v1" };

describe("verifyAgentSemanticSupport", () => {
  it("fail-closes when the verifier throws", async () => {
    const result = await verifyAgentSemanticSupport({
      question: "What did they build?",
      answer: "A booking app [1].",
      chunks: [
        {
          chunkId: "c1",
          documentId: "d1",
          documentName: "Doc",
          content: "Built a booking app.",
          similarity: 0.9,
        },
      ],
      chat,
      generate: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    expect(result.passed).toBe(false);
    expect(result.unavailable).toBe(true);
  });

  it("skips when there are no citations and no chunks", async () => {
    const generate = vi.fn();
    const result = await verifyAgentSemanticSupport({
      question: "Hi",
      answer: "Hello!",
      chunks: [],
      chat,
      generate,
    });
    expect(result.passed).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
});
