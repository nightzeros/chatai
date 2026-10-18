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
    purpose: {
      summary: "Helps visitors learn about Ada's software work.",
      represents: "Ada",
      redirect: "I can help with questions about Ada's work.",
      mode: "focused",
      origin: "owner",
      confirmedAt: "2026-01-01",
      instructionsHash: null,
    },
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
    execute: async ({ query }: { query: string }) => {
      // Age / birthday asks: no passages (unknown in-domain fact).
      if (/\b(age|old|birthday|born)\b/i.test(query)) {
        opts.onPassages([], []);
        return { passages: [], meta: { retrieveMs: 1 } };
      }
      const text = /cake|bake|cook/i.test(query)
        ? "A chocolate cake needs flour and sugar."
        : "Ada built a booking app for clinics.";
      opts.onPassages(
        [{ id: "1", documentId: "d1", chunkId: "c1", title: "Doc", text, score: 0.9 }],
        [
          {
            chunkId: "c1",
            documentId: "d1",
            documentName: "Doc",
            content: text,
            similarity: 0.9,
          },
        ],
      );
      return {
        passages: [{ id: "1", documentId: "d1", chunkId: "c1", title: "Doc", text, score: 0.9 }],
        meta: { retrieveMs: 1 },
      };
    },
  }),
}));

import { generateAgentText } from "@chatai/ai";

import { runAssistantAgent } from "./run-assistant-agent";
import { TEXT_ACCEPTANCE_FIXTURES } from "./text-acceptance-fixtures";

const chat = { provider: "openai", model: "gpt-4o-mini", apiKey: "k", baseURL: "https://api.openai.com/v1" };
const embedding = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "k",
  baseURL: "https://api.openai.com/v1",
  dimensions: 1536,
};
const emptyUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };

const passthroughRewrite = async ({ message }: { message: string }) => ({
  query: message,
  rawQuery: message,
  rewritten: false,
  usage: emptyUsage,
});

describe("M5 text acceptance fixtures", () => {
  beforeEach(() => {
    vi.mocked(generateAgentText).mockReset();
  });

  it("covers the required shared fixture set", () => {
    expect(TEXT_ACCEPTANCE_FIXTURES.map((fixture) => fixture.id).sort()).toEqual(
      [
        "ack",
        "chitchat_going",
        "greeting_plus_ask",
        "how_are_you",
        "off_topic",
        "overview",
        "slang_greeting",
        "unknown_age",
        "yes_after_offer",
      ].sort(),
    );
  });

  it.each(TEXT_ACCEPTANCE_FIXTURES.filter((fixture) => fixture.expect === "factual"))(
    "buffers factual fixture %s until validation timings are present",
    async (fixture) => {
      vi.mocked(generateAgentText).mockImplementation(async (opts) => {
        await opts.tools.searchKnowledge!.execute({ query: fixture.message });
        return {
          text: "Ada built a booking app for clinics [1].",
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
          stepUsages: [],
          steps: 1,
        };
      });

      const result = await runAssistantAgent({
        turnId: `m5_${fixture.id}`,
        db: {} as never,
        assistantId: "asst_1",
        message: fixture.message,
        history: fixture.priorAssistant
          ? [{ role: "assistant", content: fixture.priorAssistant }]
          : [],
        chat,
        embedding,
        deps: {
          rewriteRetrievalQuery: passthroughRewrite,
          verifyAgentSemanticSupport: async () => ({
            passed: true,
            unavailable: false,
            reason: "ok",
            usage: emptyUsage,
          }),
          checkPurpose: async () => ({
            decision: "in_scope",
            confidence: "high",
            rationale: "work",
            usage: emptyUsage,
            unavailable: false,
          }),
        },
      });

      expect(result.answer).toContain("booking app");
      expect(result.debug.timings).toMatchObject({
        t_agent_draft_ms: expect.any(Number),
        t_verify_ms: expect.any(Number),
        t_purpose_ms: expect.any(Number),
        t_validated_ready_ms: expect.any(Number),
      });
      expect((result.debug.timings as { t_validated_ready_ms: number }).t_validated_ready_ms).toBeGreaterThanOrEqual(
        (result.debug.timings as { t_agent_draft_ms: number }).t_agent_draft_ms,
      );
    },
  );

  it.each(TEXT_ACCEPTANCE_FIXTURES.filter((fixture) => fixture.expect === "not_in_knowledge"))(
    "answers missing in-domain fact %s without Purpose invite",
    async (fixture) => {
      vi.mocked(generateAgentText).mockImplementation(async (opts) => {
        await opts.tools.searchKnowledge!.execute({ query: fixture.message });
        return {
          text: "I am not sure about that.",
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
          stepUsages: [],
          steps: 1,
        };
      });

      const result = await runAssistantAgent({
        turnId: `m5_${fixture.id}`,
        db: {} as never,
        assistantId: "asst_1",
        message: fixture.message,
        history: [],
        chat,
        embedding,
        deps: {
          rewriteRetrievalQuery: passthroughRewrite,
          verifyAgentSemanticSupport: async () => ({
            passed: true,
            unavailable: false,
            reason: "ok",
            usage: emptyUsage,
          }),
          checkPurpose: async () => ({
            decision: "out_of_scope",
            confidence: "high",
            rationale: "should not invite",
            usage: emptyUsage,
            unavailable: false,
          }),
        },
      });

      expect(result.answer).toMatch(/available knowledge|verified sources/i);
      expect(result.answer).not.toMatch(/feel free to ask/i);
      expect(result.outcome).toBe("fallback_no_context");
    },
  );

  it("redirects off-topic without invite-loop phrasing", async () => {
    const fixture = TEXT_ACCEPTANCE_FIXTURES.find((entry) => entry.id === "off_topic")!;
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: fixture.message });
      return {
        text: "Here is a cake recipe [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "m5_off_topic",
      db: {} as never,
      assistantId: "asst_1",
      message: fixture.message,
      history: [],
      chat,
      embedding,
      deps: {
        rewriteRetrievalQuery: passthroughRewrite,
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
    expect(result.outcome).toBe("out_of_scope");
    expect(result.sources).toEqual([]);
    expect(result.debug.timings).toBeDefined();
  });

  it.each(TEXT_ACCEPTANCE_FIXTURES.filter((fixture) => fixture.expect === "social"))(
    "skips Layer C for social fixture %s",
    async (fixture) => {
      const verify = vi.fn(async () => ({
        passed: true,
        unavailable: false,
        reason: "should not run",
        usage: emptyUsage,
      }));
      vi.mocked(generateAgentText).mockResolvedValue({
        text: "You're welcome!",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      });

      const result = await runAssistantAgent({
        turnId: `m5_${fixture.id}`,
        db: {} as never,
        assistantId: "asst_1",
        message: fixture.message,
        history: [],
        chat,
        embedding,
        deps: {
          rewriteRetrievalQuery: passthroughRewrite,
          verifyAgentSemanticSupport: verify,
          checkPurpose: async () => ({
            decision: "in_scope",
            confidence: "high",
            rationale: "ok",
            usage: emptyUsage,
            unavailable: false,
          }),
        },
      });

      expect(result.answer).toBeTruthy();
      expect(verify).not.toHaveBeenCalled();
      expect((result.debug.timings as { t_verify_ms: number }).t_verify_ms).toBe(0);
    },
  );

  it("strips unsupported-but-cited claims after Layer C failure", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "overview" });
      return {
        text: "Ada won a Nobel Prize [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "m5_layer_c_fail",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me about him",
      history: [],
      chat,
      embedding,
      deps: {
        rewriteRetrievalQuery: passthroughRewrite,
        verifyAgentSemanticSupport: async () => ({
          passed: false,
          unavailable: false,
          reason: "Nobel Prize is not in the cited source.",
          usage: emptyUsage,
        }),
        // Remediation generateChat is not injected — verify fail + empty remediate → safe limitation
        generateChat: vi.fn(async () => {
          throw new Error("remediation unavailable");
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
    expect(result.answer).not.toMatch(/Nobel/i);
    expect(result.debug.verify).toMatchObject({ passed: false });
  });

  it("keeps a verified draft when Purpose judge is uncertain (evidence-backed)", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "maybe cooking" });
      return {
        text: "Ada built a booking app [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "m5_purpose_uncertain",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me about Ada and also how to bake bread",
      history: [],
      chat,
      embedding,
      deps: {
        rewriteRetrievalQuery: passthroughRewrite,
        verifyAgentSemanticSupport: async () => ({
          passed: true,
          unavailable: false,
          reason: "ok",
          usage: emptyUsage,
        }),
        checkPurpose: async () => ({
          decision: "uncertain",
          confidence: "low",
          rationale: "mixed request",
          mixed: true,
          usage: emptyUsage,
          unavailable: false,
        }),
      },
    });

    expect(result.answer).toMatch(/booking app/i);
    expect(result.answer).not.toMatch(/feel free to ask/i);
    expect(result.debug.purpose).toMatchObject({
      decision: "uncertain",
      action: "deliver",
      evidenceSupported: true,
    });
  });

  it("fail-closes factual delivery when Layer C is unavailable", async () => {
    vi.mocked(generateAgentText).mockImplementation(async (opts) => {
      await opts.tools.searchKnowledge!.execute({ query: "overview" });
      return {
        text: "Ada built a booking app [1].",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
        stepUsages: [],
        steps: 1,
      };
    });

    const result = await runAssistantAgent({
      turnId: "m5_verify_unavailable",
      db: {} as never,
      assistantId: "asst_1",
      message: "Tell me about him",
      history: [],
      chat,
      embedding,
      deps: {
        rewriteRetrievalQuery: passthroughRewrite,
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
    expect(result.answer).not.toContain("booking app");
    expect(result.debug.verify).toMatchObject({ unavailable: true });
  });
});
