import { describe, expect, it, vi } from "vitest";

import { parseJudgeScore } from "./parse-score";
import { loadOnlineEvalContext } from "./load-context";
import { scoreMessage, summarizeScores } from "./score-message";
import { enqueueOnlineEvalJob, runOnlineEvalJob, shouldSampleEval } from "./run-online-eval";

describe("shouldSampleEval", () => {
  it("never samples when the rate is zero", () => {
    expect(shouldSampleEval(0, () => 0)).toBe(false);
    expect(shouldSampleEval(0, () => 0.99)).toBe(false);
  });
  it("samples according to the configured rate", () => {
    expect(shouldSampleEval(0.25, () => 0.2)).toBe(true);
    expect(shouldSampleEval(0.25, () => 0.9)).toBe(false);
  });
});

describe("parseJudgeScore", () => {
  it("parses JSON judge responses", () => {
    expect(parseJudgeScore('{"score":0.82}')).toBe(0.82);
  });

  it("clamps out-of-range values", () => {
    expect(parseJudgeScore('{"score":1.4}')).toBe(1);
    expect(parseJudgeScore('{"score":-0.2}')).toBe(0);
  });
});

describe("scoreMessage", () => {
  it("returns all four metrics with mocked judges", async () => {
    const generateChat = vi
      .fn()
      .mockResolvedValueOnce('{"score":0.9}')
      .mockResolvedValueOnce('{"score":0.8}')
      .mockResolvedValueOnce('{"score":0.7}');

    const result = await scoreMessage({
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      context: {
        question: "What is the refund policy?",
        answer: "You can request a refund within 30 days [1].",
        context: "[1] Policy\nRefunds are available within 30 days.",
        sources: [{ documentId: "doc-1", documentName: "Policy", chunkId: "chunk-1" }],
        retrieval: [
          {
            chunkId: "chunk-1",
            documentId: "doc-1",
            documentName: "Policy",
            similarity: 0.91,
          },
        ],
      },
      deps: { generateChat },
    });

    expect(result.scores).toHaveLength(4);
    expect(result.scores.map((score) => score.metric)).toEqual([
      "faithfulness",
      "contextRelevance",
      "answerRelevance",
      "citationCorrectness",
    ]);
    expect(result.scores[0]?.score).toBe(0.9);
    expect(result.scores[3]?.metric).toBe("citationCorrectness");
    expect(result.providerUsages.length).toBe(3);
  });
});

describe("summarizeScores", () => {
  it("builds an averages map", () => {
    expect(
      summarizeScores([
        { metric: "faithfulness", score: 0.9 },
        { metric: "answerRelevance", score: 0.7 },
      ]),
    ).toEqual({
      scoredCount: 2,
      averages: {
        faithfulness: 0.9,
        answerRelevance: 0.7,
      },
    });
  });
});

describe("loadOnlineEvalContext", () => {
  it("reconstructs question, answer, and context from stored message debug", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                id: "msg-1",
                role: "assistant",
                conversationId: "conv-1",
                content: "Refunds are available within 30 days [1].",
                sources: [{ documentId: "doc-1", documentName: "Policy", chunkId: "chunk-1" }],
                debug: {
                  question: "What is the refund policy?",
                  retrieval: [
                    {
                      chunkId: "chunk-1",
                      documentId: "doc-1",
                      documentName: "Policy",
                      similarity: 0.91,
                    },
                  ],
                },
              },
            ],
          }),
        }),
      }),
    };

    const conversationDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "conv-1", assistantId: "asst-1" }],
          }),
        }),
      }),
    };

    const chunksDb = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: "chunk-1",
              content: "Refunds are available within 30 days.",
              parentContent: null,
            },
          ],
        }),
      }),
    };

    let selectCount = 0;
    const mergedDb = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) return db.select();
        if (selectCount === 2) return conversationDb.select();
        return chunksDb.select();
      },
    };

    const loaded = await loadOnlineEvalContext(mergedDb as never, "msg-1");
    expect(loaded?.assistantId).toBe("asst-1");
    expect(loaded?.context.question).toBe("What is the refund policy?");
    expect(loaded?.context.context).toContain("Refunds are available within 30 days.");
  });
});

describe("runOnlineEvalJob", () => {
  it("writes eval run and score rows", async () => {
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
                  {
                    id: "msg-1",
                    role: "assistant",
                    conversationId: "conv-1",
                    content: "Answer [1].",
                    sources: [{ documentId: "doc-1", documentName: "Policy" }],
                    debug: {
                      question: "Question?",
                      retrieval: [
                        {
                          chunkId: "chunk-1",
                          documentId: "doc-1",
                          documentName: "Policy",
                          similarity: 0.5,
                        },
                      ],
                    },
                  },
                ],
              }),
            }),
          };
        }
        if (selectCount === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "conv-1", assistantId: "asst-1" }],
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: async () => [{ id: "chunk-1", content: "Policy text", parentContent: null }],
          }),
        };
      },
      insert: () => ({
        values: async (rows: unknown | unknown[]) => {
          inserted.push(...(Array.isArray(rows) ? rows : [rows]));
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    };

    const generateChat = vi.fn(async () => '{"score":0.88}');
    const result = await runOnlineEvalJob({
      db: db as never,
      messageId: "msg-1",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: { generateChat },
    });

    expect(result.scores).toHaveLength(4);
    expect(inserted.length).toBeGreaterThanOrEqual(5);
    expect(generateChat).toHaveBeenCalled();
  });
});

describe("enqueueOnlineEvalJob", () => {
  it("creates a pending online eval job", async () => {
    const inserted: unknown[] = [];
    const db = {
      insert: () => ({
        values: async (row: unknown) => {
          inserted.push(row);
        },
      }),
    };

    const jobId = await enqueueOnlineEvalJob({ db: db as never, messageId: "msg-1" });
    expect(jobId).toBeTruthy();
    expect(inserted[0]).toMatchObject({
      messageId: "msg-1",
      status: "pending",
      attempts: 0,
    });
  });
});
