import { describe, expect, it, vi } from "vitest";

import { aggregateRunSummary } from "./score-message";
import { assertReadyToRun, maybeFinalizeOfflineRun, runOfflineEvalCase } from "./run-offline-eval";

describe("assertReadyToRun", () => {
  it("rejects empty case lists", () => {
    expect(() => assertReadyToRun([])).toThrow(/at least one question/i);
  });
});

describe("aggregateRunSummary", () => {
  it("averages the same metric across cases", () => {
    expect(
      aggregateRunSummary(
        [
          { metric: "faithfulness", score: 1, caseId: "c1" },
          { metric: "faithfulness", score: 0.5, caseId: "c2" },
          { metric: "answerRelevance", score: 0.8, caseId: "c1" },
          { metric: "answerRelevance", score: 0.6, caseId: "c2" },
        ],
        2,
      ),
    ).toEqual({
      caseCount: 2,
      scoredCount: 2,
      averages: {
        faithfulness: 0.75,
        answerRelevance: 0.7,
      },
    });
  });
});

describe("runOfflineEvalCase", () => {
  it("generates an answer, scores it, and writes eval_scores", async () => {
    const inserted: unknown[] = [];
    let selectCount = 0;
    const db = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [
                  { id: "case-1", question: "What is the refund policy?", expectedAnswer: "30 days" },
                ],
              }),
            }),
          };
        }
        if (selectCount === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "run-1", assistantId: "asst-1", kind: "offline" }],
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "asst-1",
                  instructions: "Be helpful.",
                  hallucinationMode: "balanced",
                  ragSettings: {},
                },
              ],
            }),
          }),
        };
      },
      insert: () => ({
        values: async (rows: unknown | unknown[]) => {
          inserted.push(...(Array.isArray(rows) ? rows : [rows]));
        },
      }),
    };

    const generateChat = vi.fn(async () => '{"score":0.9}');
    const prepareAnswer = vi.fn(async () => ({
      query: "What is the refund policy?",
      retrieved: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "Policy",
          content: "Refunds are available within 30 days.",
          similarity: 0.9,
        },
      ],
      decision: { action: "generate", contextSufficient: true, confidence: "high", mode: "balanced" },
      outcome: "answered_with_context",
      confidence: 0.9,
      system: "You are a helpful assistant.",
      shouldGenerate: true,
      fallbackText: "I could not find enough information.",
      debug: {
        retrieval: [
          {
            chunkId: "chunk-1",
            documentId: "doc-1",
            documentName: "Policy",
            similarity: 0.9,
          },
        ],
      },
      providerUsages: [],
    }));

    const result = await runOfflineEvalCase({
      db: db as never,
      runId: "run-1",
      caseId: "case-1",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      embedding: { apiKey: "test", baseURL: "https://example.com/v1", model: "emb", dimensions: 1536 },
      deps: {
        prepareAnswer: prepareAnswer as never,
        generateChat,
      },
    });

    expect(prepareAnswer).toHaveBeenCalledOnce();
    expect(result.answer).toBe('{"score":0.9}');
    expect(result.scores).toHaveLength(4);
    expect(inserted).toHaveLength(4);
    expect(inserted[0]).toMatchObject({
      runId: "run-1",
      caseId: "case-1",
      details: expect.objectContaining({
        snapshot: expect.objectContaining({
          question: "What is the refund policy?",
          answer: expect.any(String),
          retrieval: expect.arrayContaining([
            expect.objectContaining({
              index: 1,
              chunkId: "chunk-1",
              documentName: "Policy",
              content: expect.any(String),
            }),
          ]),
        }),
      }),
    });
  });

  it("keeps provider usages in the collector when score persistence fails", async () => {
    const collector: Array<{ step?: string; kind: string }> = [];
    let selectCount = 0;
    const db = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [
                  { id: "case-1", question: "What is the refund policy?", expectedAnswer: "30 days" },
                ],
              }),
            }),
          };
        }
        if (selectCount === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "run-1", assistantId: "asst-1", kind: "offline" }],
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "asst-1",
                  instructions: "Be helpful.",
                  hallucinationMode: "balanced",
                  ragSettings: {},
                },
              ],
            }),
          }),
        };
      },
      insert: () => ({
        values: async () => {
          throw new Error("eval_scores insert failed");
        },
      }),
    };

    const generateChat = vi.fn(async () => '{"score":0.9}');
    const prepareAnswer = vi.fn(async () => ({
      query: "What is the refund policy?",
      retrieved: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "Policy",
          content: "Refunds are available within 30 days.",
          similarity: 0.9,
        },
      ],
      decision: { action: "generate", contextSufficient: true, confidence: "high", mode: "balanced" },
      outcome: "answered_with_context",
      confidence: 0.9,
      system: "You are a helpful assistant.",
      shouldGenerate: true,
      fallbackText: "I could not find enough information.",
      debug: {
        retrieval: [
          {
            chunkId: "chunk-1",
            documentId: "doc-1",
            documentName: "Policy",
            similarity: 0.9,
          },
        ],
      },
      providerUsages: [
        {
          kind: "embedding",
          provider: "openai",
          model: "text-embedding-3-small",
          usage: { inputTokens: 12, outputTokens: 0, totalTokens: 12 },
          step: "offline_eval_embed",
        },
      ],
    }));

    await expect(
      runOfflineEvalCase({
        db: db as never,
        runId: "run-1",
        caseId: "case-1",
        chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
        embedding: { apiKey: "test", baseURL: "https://example.com/v1", model: "emb", dimensions: 1536 },
        usageCollector: collector as never,
        deps: {
          prepareAnswer: prepareAnswer as never,
          generateChat,
        },
      }),
    ).rejects.toThrow(/eval_scores insert failed/);

    expect(collector.length).toBeGreaterThan(0);
    expect(collector.some((u) => u.step === "offline_eval_embed")).toBe(true);
    expect(collector.some((u) => u.step === "offline_eval_answer")).toBe(true);
    expect(collector.some((u) => u.step?.startsWith("eval_judge_"))).toBe(true);
  });
});

describe("maybeFinalizeOfflineRun", () => {
  it("writes completed summary when every job is done", async () => {
    const updates: unknown[] = [];
    let selectCount = 0;
    const db = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              where: async () => [{ id: "job-1", status: "completed", runId: "run-1" }],
            }),
          };
        }
        return {
          from: () => ({
            where: async () => [
              { metric: "faithfulness", score: 0.8, caseId: "case-1" },
              { metric: "answerRelevance", score: 0.6, caseId: "case-1" },
            ],
          }),
        };
      },
      update: () => ({
        set: (values: unknown) => ({
          where: async () => {
            updates.push(values);
          },
        }),
      }),
    };

    const summary = await maybeFinalizeOfflineRun({ db: db as never, runId: "run-1" });
    expect(summary?.averages?.faithfulness).toBe(0.8);
    expect(updates[0]).toMatchObject({ status: "completed" });
  });

  it("waits when jobs are still processing", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [
            { id: "job-1", status: "completed", runId: "run-1" },
            { id: "job-2", status: "processing", runId: "run-1" },
          ],
        }),
      }),
    };

    await expect(maybeFinalizeOfflineRun({ db: db as never, runId: "run-1" })).resolves.toBeNull();
  });
});
