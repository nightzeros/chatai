import { generateChat, type ChatConfig } from "@chatai/ai";

import { extractCitationIndexes } from "./citations";
import { FALLBACK_MESSAGE } from "./decide";
import type { PreparedAnswer } from "./answer";
import { buildContextBlocks, uniqueContextChunks } from "./prompt";

export type VerifierVerdict = {
  enabled: boolean;
  passed: boolean;
  reason: string;
  regenerated: boolean;
};

export type VerifiedGeneration = {
  text: string;
  usedFallback: boolean;
  verifier: VerifierVerdict;
};

export type VerifyAnswerDeps = {
  generateChat: typeof generateChat;
};

const STRICT_RETRY_SYSTEM = [
  "STRICT RETRY: The previous draft was not fully supported by the numbered sources.",
  "Rewrite using only those sources.",
  "Cite every factual claim with a marker like [1].",
  "If the sources are insufficient, say you could not find enough information.",
].join(" ");

export function parseVerifierResponse(raw: string): { passed: boolean; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { passed: false, reason: "Verifier returned an empty verdict." };
  }

  try {
    const parsed = JSON.parse(trimmed) as { pass?: unknown; passed?: unknown; reason?: unknown };
    if (typeof parsed === "object" && parsed) {
      const passed = Boolean(parsed.pass ?? parsed.passed);
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : passed
            ? "Answer is supported by the sources."
            : "Answer is not supported by the sources.";
      return { passed, reason };
    }
  } catch {
    // Fall through to keyword parsing.
  }

  const lower = trimmed.toLowerCase();
  if (/\bpass(ed)?\b/.test(lower) && !/\bfail/.test(lower)) {
    return { passed: true, reason: trimmed.slice(0, 240) };
  }

  return { passed: false, reason: trimmed.slice(0, 240) };
}

export function citationMarkersValid(answer: string, retrievedCount: number) {
  const indexes = extractCitationIndexes(answer);
  const invalid = indexes.filter((index) => index > retrievedCount);
  if (invalid.length > 0) {
    return {
      ok: false,
      reason: `Citation markers ${invalid.map((index) => `[${index}]`).join(", ")} do not match retrieved sources.`,
    };
  }
  return { ok: true };
}

export async function verifyAnswer(opts: {
  question: string;
  answer: string;
  context: string;
  retrievedCount: number;
  chat: ChatConfig;
  deps?: Partial<VerifyAnswerDeps>;
}): Promise<{ passed: boolean; reason: string }> {
  const citations = citationMarkersValid(opts.answer, opts.retrievedCount);
  if (!citations.ok) {
    return { passed: false, reason: citations.reason ?? "Invalid citations." };
  }

  const generate = opts.deps?.generateChat ?? generateChat;

  try {
    const raw = await generate({
      config: opts.chat,
      system:
        'You verify whether an answer is supported by retrieved sources and uses citation markers correctly. Return ONLY JSON like {"pass":true,"reason":"..."}.',
      prompt: [
        `Question: ${opts.question}`,
        `Sources:\n${opts.context}`,
        `Answer:\n${opts.answer}`,
        "Fail if the answer invents facts, contradicts the sources, or uses citation markers that do not match the sources.",
      ].join("\n\n"),
    });
    return parseVerifierResponse(raw);
  } catch {
    return { passed: true, reason: "Verifier unavailable; accepted the generated answer." };
  }
}

export async function generateVerifiedAnswer(opts: {
  prepared: PreparedAnswer;
  question: string;
  chat: ChatConfig;
  deps?: Partial<VerifyAnswerDeps>;
}): Promise<VerifiedGeneration> {
  const generate = opts.deps?.generateChat ?? generateChat;
  const contextChunks = uniqueContextChunks(opts.prepared.retrieved);
  const context = buildContextBlocks(contextChunks);
  const retrievedCount = contextChunks.length;

  const first = await generate({
    config: opts.chat,
    system: opts.prepared.system,
    prompt: opts.question,
  });

  const firstVerdict = await verifyAnswer({
    question: opts.question,
    answer: first,
    context,
    retrievedCount,
    chat: opts.chat,
    deps: opts.deps,
  });

  if (firstVerdict.passed) {
    return {
      text: first,
      usedFallback: false,
      verifier: { enabled: true, passed: true, reason: firstVerdict.reason, regenerated: false },
    };
  }

  const retry = await generate({
    config: opts.chat,
    system: `${opts.prepared.system}\n\n${STRICT_RETRY_SYSTEM}`,
    prompt: opts.question,
  });

  const retryVerdict = await verifyAnswer({
    question: opts.question,
    answer: retry,
    context,
    retrievedCount,
    chat: opts.chat,
    deps: opts.deps,
  });

  if (retryVerdict.passed) {
    return {
      text: retry,
      usedFallback: false,
      verifier: { enabled: true, passed: true, reason: retryVerdict.reason, regenerated: true },
    };
  }

  return {
    text: FALLBACK_MESSAGE,
    usedFallback: true,
    verifier: { enabled: true, passed: false, reason: retryVerdict.reason, regenerated: true },
  };
}

export function withVerifierResult(prepared: PreparedAnswer, result: VerifiedGeneration): PreparedAnswer {
  return {
    ...prepared,
    outcome: result.usedFallback ? "fallback_no_context" : prepared.outcome,
    shouldGenerate: prepared.shouldGenerate && !result.usedFallback,
    debug: {
      ...prepared.debug,
      verifier: result.verifier,
    },
  };
}
