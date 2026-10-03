import { describe, expect, it, vi } from "vitest";

import type { PreparedAnswer } from "./answer";
import { FALLBACK_MESSAGE } from "./decide";
import {
  checkOutputScope,
  generateGuardedAnswer,
  guardReplacement,
  hasRecentRedirect,
  isLongConversationalReply,
  parseOnPurpose,
  riskReasons,
  type OutputGuardPlan,
} from "./output-guard";
import { PARTIAL_REDIRECT_SENTENCE } from "./scope";

const chat = { apiKey: "test", baseURL: "https://example.com/v1", model: "test" };
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0 };
const REDIRECT = "I can help with appointments and opening hours. What would you like to know?";

function plan(overrides: Partial<OutputGuardPlan> = {}): OutputGuardPlan {
  return {
    reasons: [],
    purposeBlock: "# Purpose\nDental clinic appointments and hours.",
    request: "When are you open?",
    decision: "in",
    injectionSuspected: false,
    redirect: REDIRECT,
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedAnswer> = {}): PreparedAnswer {
  return {
    query: "When are you open?",
    retrieved: [],
    decision: { contextSufficient: true, confidence: "high", bestScore: 0.9, mode: "balanced", action: "generate" },
    outcome: "answered_with_context",
    confidence: 0.9,
    system: "SYSTEM",
    shouldGenerate: true,
    fallbackText: FALLBACK_MESSAGE,
    messages: [{ role: "user", content: "When are you open?" }],
    turn: { kind: "knowledge", retrieval: "performed" },
    debug: { question: "When are you open?", retrieval: [], model: "test", latencyMs: 1 },
    providerUsages: [],
    ...overrides,
  } as PreparedAnswer;
}

const checker = (raw: string | Error) =>
  vi.fn(async () => {
    if (raw instanceof Error) throw raw;
    return raw;
  });

describe("risk gate", () => {
  it("flags partial, unknown, injection, weak grounding, flexible and a recent redirect", () => {
    expect(
      riskReasons({
        decision: "partial",
        injectionSuspected: true,
        contextSufficient: false,
        confidence: "low",
        mode: "flexible",
        history: [{ role: "assistant", content: REDIRECT, redirected: true }],
      }),
    ).toEqual(["partial", "injection", "weak_grounding", "flexible", "recent_redirect"]);
    expect(
      riskReasons({ decision: "unknown", injectionSuspected: false, contextSufficient: true, confidence: "high", mode: "strict", history: [] }),
    ).toEqual(["unknown"]);
  });

  it("an ordinary well-grounded in-scope turn is not gated", () => {
    expect(
      riskReasons({ decision: "in", injectionSuspected: false, contextSufficient: true, confidence: "high", mode: "balanced", history: [] }),
    ).toEqual([]);
  });

  it("recent redirect looks only at the last few messages", () => {
    const old = [
      { role: "assistant" as const, content: REDIRECT, redirected: true },
      ...Array.from({ length: 4 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "assistant" | "user", content: "x" })),
    ];
    expect(hasRecentRedirect(old)).toBe(false);
  });

  it("long conversational replies are over 60 words", () => {
    expect(isLongConversationalReply("word ".repeat(61))).toBe(true);
    expect(isLongConversationalReply("Hello! How can I help?")).toBe(false);
  });
});

describe("checker", () => {
  it("parses strict and lenient onPurpose output", () => {
    expect(parseOnPurpose('{"offTopic":false}')).toBe(true);
    expect(parseOnPurpose('{"offTopic":true}')).toBe(false);
    expect(parseOnPurpose('Result: "offTopic": true')).toBe(false);
    expect(parseOnPurpose('{"onPurpose":true}')).toBe(true);
    expect(parseOnPurpose('```json\n{"onPurpose":false}\n```')).toBe(false);
    expect(parseOnPurpose('Sure: "onPurpose": false')).toBe(false);
    expect(parseOnPurpose("maybe")).toBeNull();
  });

  it("returns null on timeout without throwing", async () => {
    const slow = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('{"onPurpose":true}'), 200)));
    const result = await checkOutputScope({
      purposeBlock: "p",
      request: "r",
      answer: "a",
      chat,
      generate: slow as never,
      timeoutMs: 10,
    });
    expect(result.onPurpose).toBeNull();
  });

  it("deterministic replacements per decision", () => {
    expect(guardReplacement(plan())).toEqual({ text: REDIRECT, outcome: "out_of_scope" });
    expect(guardReplacement(plan({ decision: "partial" }))).toEqual({
      text: `${FALLBACK_MESSAGE} ${PARTIAL_REDIRECT_SENTENCE}`,
      outcome: "fallback_no_context",
    });
    expect(guardReplacement(plan({ decision: "unknown" }))).toEqual({
      text: `${FALLBACK_MESSAGE} ${REDIRECT}`,
      outcome: "fallback_no_context",
    });
  });
});

describe("generateGuardedAnswer", () => {
  const generate = (text: string) => vi.fn(async () => ({ text, usage }));

  it("ungated Text streams and pays for no check", async () => {
    const stream = vi.fn(async (_args: unknown, onDelta: (t: string) => void) => {
      onDelta("Open 8 to 6 [1].");
      return { text: "Open 8 to 6 [1].", usage };
    });
    const onDelta = vi.fn();
    const deps = { generateChat: checker('{"onPurpose":false}') };
    const result = await generateGuardedAnswer({
      prepared: prepared({ guard: plan() }),
      question: "When are you open?",
      chat,
      verifyCitations: false,
      outputGuard: true,
      generate: generate("unused"),
      stream,
      onDelta,
      deps: deps as never,
    });
    expect(result).toMatchObject({ streamed: true, text: "Open 8 to 6 [1]." });
    expect(result.guard).toBeUndefined();
    expect(deps.generateChat).not.toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalledWith("Open 8 to 6 [1].");
  });

  it("a gated answer that drifts off-purpose is replaced by the Purpose redirect", async () => {
    const deps = { generateChat: checker('{"onPurpose":false}') };
    const stream = vi.fn();
    const result = await generateGuardedAnswer({
      prepared: prepared({ guard: plan({ reasons: ["flexible"] }) }),
      question: "When are you open?",
      chat,
      verifyCitations: false,
      outputGuard: true,
      generate: generate("Here is a lasagna recipe..."),
      stream,
      deps: deps as never,
    });
    expect(stream).not.toHaveBeenCalled();
    expect(result.text).toBe(REDIRECT);
    expect(result.prepared.outcome).toBe("out_of_scope");
    expect(result.guard).toMatchObject({ gated: true, method: "checker", passed: false, replaced: true });
    expect(result.usages.map((u) => u.step)).toEqual(["stream_answer", "output_scope_check"]);
  });

  it("a passing partial answer gets the server-appended sentence; the model only saw the in-scope request", async () => {
    const gen = generate("We open at 8 [1].");
    const result = await generateGuardedAnswer({
      prepared: prepared({
        guard: plan({ decision: "partial", reasons: ["partial"], request: "opening hours" }),
        answerRequest: "opening hours",
        answerSuffix: PARTIAL_REDIRECT_SENTENCE,
      }),
      question: "When are you open, and what laptop should I buy?",
      chat,
      verifyCitations: false,
      outputGuard: true,
      generate: gen,
      deps: { generateChat: checker('{"onPurpose":true}') } as never,
    });
    expect(result.text).toBe(`We open at 8 [1]. ${PARTIAL_REDIRECT_SENTENCE}`);
    expect(result.guard).toMatchObject({ passed: true });
  });

  it("a partial answer that fails the check gets fallback plus the partial sentence", async () => {
    const result = await generateGuardedAnswer({
      prepared: prepared({
        guard: plan({ decision: "partial", reasons: ["partial"] }),
        answerSuffix: PARTIAL_REDIRECT_SENTENCE,
      }),
      question: "q",
      chat,
      verifyCitations: false,
      outputGuard: true,
      generate: generate("Buy the X1 laptop."),
      deps: { generateChat: checker('{"onPurpose":false}') } as never,
    });
    expect(result.text).toBe(`${FALLBACK_MESSAGE} ${PARTIAL_REDIRECT_SENTENCE}`);
    expect(result.prepared.outcome).toBe("fallback_no_context");
  });

  it("check failure fails closed only for unknown or injection turns", async () => {
    const run = (overrides: Partial<OutputGuardPlan>) =>
      generateGuardedAnswer({
        prepared: prepared({ guard: plan(overrides) }),
        question: "q",
        chat,
        verifyCitations: false,
        outputGuard: true,
        generate: generate("Answer [1]."),
        deps: { generateChat: checker(new Error("down")) } as never,
      });
    const unknown = await run({ decision: "unknown", reasons: ["unknown"] });
    expect(unknown.guard).toMatchObject({ unavailable: true, failClosed: true, replaced: true });
    expect(unknown.text).toBe(`${FALLBACK_MESSAGE} ${REDIRECT}`);

    const injection = await run({ injectionSuspected: true, reasons: ["injection"] });
    expect(injection.guard).toMatchObject({ failClosed: true, replaced: true });

    const flexible = await run({ reasons: ["flexible"] });
    expect(flexible.guard).toMatchObject({ unavailable: true, passed: true });
    expect(flexible.text).toBe("Answer [1].");
  });

  it("buffered ungated answers without citations after retrieval are checked (uncited)", async () => {
    const deps = { generateChat: checker('{"onPurpose":true}') };
    const result = await generateGuardedAnswer({
      prepared: prepared({ guard: plan() }),
      question: "q",
      chat,
      verifyCitations: false,
      outputGuard: true,
      generate: generate("No citations here."),
      deps: deps as never,
    });
    expect(result.guard).toMatchObject({ reasons: ["uncited"], passed: true });
    expect(deps.generateChat).toHaveBeenCalledTimes(1);
  });

  it("uses the verifier's onPurpose verdict in the same call when citations are verified", async () => {
    const generateVerified = vi.fn(async () => ({
      text: "Off-topic answer.",
      usedFallback: false,
      verifier: { enabled: true, passed: true, reason: "ok", regenerated: false, onPurpose: false },
      providerUsages: [],
    }));
    const deps = { generateChat: checker('{"onPurpose":true}') };
    const result = await generateGuardedAnswer({
      prepared: prepared({ guard: plan({ reasons: ["weak_grounding"] }) }),
      question: "q",
      chat,
      verifyCitations: true,
      outputGuard: true,
      generate: generate("unused"),
      generateVerified: generateVerified as never,
      deps: deps as never,
    });
    expect((generateVerified.mock.calls[0] as unknown[] | undefined)?.[0]).toMatchObject({
      purposeCheck: { request: "When are you open?", requestAccepted: true },
    });
    expect(deps.generateChat).not.toHaveBeenCalled();
    expect(result.guard).toMatchObject({ method: "verifier", passed: false, replaced: true });
    expect(result.text).toBe(REDIRECT);
  });

  it("disabled guard never checks", async () => {
    const deps = { generateChat: checker('{"onPurpose":false}') };
    const result = await generateGuardedAnswer({
      prepared: prepared({ guard: plan({ reasons: ["flexible"] }) }),
      question: "q",
      chat,
      verifyCitations: false,
      outputGuard: false,
      generate: generate("Anything."),
      deps: deps as never,
    });
    expect(result.guard).toBeUndefined();
    expect(deps.generateChat).not.toHaveBeenCalled();
  });
});
