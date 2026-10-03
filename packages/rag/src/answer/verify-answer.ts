import {
  emptyProviderUsage,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
} from "@chatai/ai";

import { extractCitationIndexes } from "./citations";
import { FALLBACK_MESSAGE } from "./decide";
import type { PreparedAnswer } from "./answer";
import { buildContextBlocks, uniqueContextChunks } from "./prompt";
import type { ProviderUsageRecord } from "./provider-usage";

export type VerifierVerdict = {
  enabled: boolean;
  passed: boolean;
  reason: string;
  regenerated: boolean;
  /** Output scope result when the verifier also checked the Purpose (null: not reported). */
  onPurpose?: boolean | null;
};

/** Ask the verifier to also report whether the answer stays within the Purpose (same call). */
export type PurposeCheck = {
  purposeBlock: string;
  request: string;
  /** The Scope Router accepted the request (in or partial); only the reply is judged. */
  requestAccepted?: boolean;
};

/** Shared by the verifier and the output checker when the request was already accepted. */
export const OUTPUT_CHECK_ACCEPTED_REQUEST =
  "The request was already accepted as within the Purpose, so answering it is on purpose. Judge only whether the reply adds help, information or engagement on a different topic outside the Purpose, or takes on another role.";

export type VerifiedGeneration = {
  text: string;
  usedFallback: boolean;
  verifier: VerifierVerdict;
  providerUsages: ProviderUsageRecord[];
};

export type VerifyAnswerDeps = {
  generateChat: GenerateChatFn;
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

function chatUsageRecord(
  chat: ChatConfig,
  usage: ProviderUsage,
  step: string,
): ProviderUsageRecord {
  return {
    kind: "chat_completion",
    provider: chat.provider,
    model: chat.model,
    usage,
    step,
  };
}

export async function verifyAnswer(opts: {
  question: string;
  answer: string;
  context: string;
  retrievedCount: number;
  chat: ChatConfig;
  purposeCheck?: PurposeCheck;
  deps?: Partial<VerifyAnswerDeps>;
}): Promise<{ passed: boolean; reason: string; usage: ProviderUsage; onPurpose?: boolean | null }> {
  const citations = citationMarkersValid(opts.answer, opts.retrievedCount);
  if (!citations.ok) {
    return {
      passed: false,
      reason: citations.reason ?? "Invalid citations.",
      usage: emptyProviderUsage(),
      ...(opts.purposeCheck ? { onPurpose: null } : {}),
    };
  }

  const generate = opts.deps?.generateChat ?? generateChat;
  const purpose = opts.purposeCheck;

  try {
    const { text: raw, usage } = await runGenerateChat(generate, {
      config: opts.chat,
      system: purpose
        ? 'You verify whether an answer is supported by retrieved sources, uses citation markers correctly, and stays within the assistant\'s Purpose. Return ONLY JSON like {"pass":true,"onPurpose":true,"reason":"..."}.'
        : 'You verify whether an answer is supported by retrieved sources and uses citation markers correctly. Return ONLY JSON like {"pass":true,"reason":"..."}.',
      prompt: [
        `Question: ${opts.question}`,
        `Sources:\n${opts.context}`,
        `Answer:\n${opts.answer}`,
        "Fail if the answer invents facts, contradicts the sources, or uses citation markers that do not match the sources.",
        ...(purpose
          ? [
              `Purpose:\n${purpose.purposeBlock.slice(0, 2_000)}`,
              ...(purpose.requestAccepted ? [OUTPUT_CHECK_ACCEPTED_REQUEST] : []),
              '"onPurpose" is false only if the answer gives help, information, suggestions or engagement on a subject unrelated to the Purpose (for example a recipe, travel plans, shopping advice, a joke, story or poem, code, or general trivia), even partly, or takes on another role. Facts about the organization, person or subject the assistant represents are within the Purpose.',
            ]
          : []),
      ].join("\n\n"),
    });
    const verdict = parseVerifierResponse(raw);
    return { ...verdict, usage, ...(purpose ? { onPurpose: parseOnPurposeField(raw) } : {}) };
  } catch {
    return {
      passed: true,
      reason: "Verifier unavailable; accepted the generated answer.",
      usage: emptyProviderUsage(),
      ...(purpose ? { onPurpose: null } : {}),
    };
  }
}

function parseOnPurposeField(raw: string): boolean | null {
  try {
    const parsed = JSON.parse(raw.trim()) as { onPurpose?: unknown };
    return typeof parsed?.onPurpose === "boolean" ? parsed.onPurpose : null;
  } catch {
    return null;
  }
}

export async function generateVerifiedAnswer(opts: {
  prepared: PreparedAnswer;
  question: string;
  chat: ChatConfig;
  purposeCheck?: PurposeCheck;
  deps?: Partial<VerifyAnswerDeps>;
}): Promise<VerifiedGeneration> {
  const generate = opts.deps?.generateChat ?? generateChat;
  const contextChunks = uniqueContextChunks(opts.prepared.retrieved);
  const context = buildContextBlocks(contextChunks);
  const retrievedCount = contextChunks.length;
  const providerUsages: ProviderUsageRecord[] = [];
  const messages = opts.prepared.messages?.length
    ? opts.prepared.messages
    : [{ role: "user" as const, content: opts.question }];

  const first = await runGenerateChat(generate, {
    config: opts.chat,
    system: opts.prepared.system,
    messages,
  });
  providerUsages.push(chatUsageRecord(opts.chat, first.usage, "verified_answer"));

  const firstVerdict = await verifyAnswer({
    question: opts.question,
    answer: first.text,
    context,
    retrievedCount,
    chat: opts.chat,
    purposeCheck: opts.purposeCheck,
    deps: opts.deps,
  });
  providerUsages.push(chatUsageRecord(opts.chat, firstVerdict.usage, "verify_answer"));
  const purposeField = (verdict: { onPurpose?: boolean | null }) =>
    opts.purposeCheck ? { onPurpose: verdict.onPurpose ?? null } : {};

  // An off-purpose draft is replaced by the caller; regenerating it would not help.
  if (firstVerdict.passed || firstVerdict.onPurpose === false) {
    return {
      text: first.text,
      usedFallback: false,
      verifier: {
        enabled: true,
        passed: firstVerdict.passed,
        reason: firstVerdict.reason,
        regenerated: false,
        ...purposeField(firstVerdict),
      },
      providerUsages,
    };
  }

  const retry = await runGenerateChat(generate, {
    config: opts.chat,
    system: `${opts.prepared.system}\n\n${STRICT_RETRY_SYSTEM}`,
    messages,
  });
  providerUsages.push(chatUsageRecord(opts.chat, retry.usage, "verified_answer_retry"));

  const retryVerdict = await verifyAnswer({
    question: opts.question,
    answer: retry.text,
    context,
    retrievedCount,
    chat: opts.chat,
    purposeCheck: opts.purposeCheck,
    deps: opts.deps,
  });
  providerUsages.push(chatUsageRecord(opts.chat, retryVerdict.usage, "verify_answer_retry"));

  if (retryVerdict.passed || retryVerdict.onPurpose === false) {
    return {
      text: retry.text,
      usedFallback: false,
      verifier: {
        enabled: true,
        passed: retryVerdict.passed,
        reason: retryVerdict.reason,
        regenerated: true,
        ...purposeField(retryVerdict),
      },
      providerUsages,
    };
  }

  return {
    text: FALLBACK_MESSAGE,
    usedFallback: true,
    verifier: {
      enabled: true,
      passed: false,
      reason: retryVerdict.reason,
      regenerated: true,
      ...purposeField(retryVerdict),
    },
    providerUsages,
  };
}

export function withVerifierResult(prepared: PreparedAnswer, result: VerifiedGeneration): PreparedAnswer {
  return {
    ...prepared,
    outcome: result.usedFallback ? "fallback_no_context" : prepared.outcome,
    shouldGenerate: prepared.shouldGenerate && !result.usedFallback,
    providerUsages: [...(prepared.providerUsages ?? []), ...(result.providerUsages ?? [])],
    debug: {
      ...prepared.debug,
      verifier: result.verifier,
    },
  };
}
