import {
  emptyProviderUsage,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
} from "@chatai/ai";

import { buildContextBlocks } from "../answer/prompt";
import type { ProviderUsageRecord } from "../answer/provider-usage";
import type { RetrievedChunk } from "../answer/retrieve";
import { parseVerifierResponse } from "../answer/verify-answer";
import { bindCitationsToTurnEvidence } from "./citation-bind";

export type AgentVerifyResult = {
  passed: boolean;
  unavailable: boolean;
  reason: string;
  usage: ProviderUsage;
};

/**
 * Layer C — semantic support. Fail closed when the verifier is unavailable.
 * A valid citation (Layer B) is not proof of support.
 */
export async function verifyAgentSemanticSupport(opts: {
  question: string;
  answer: string;
  chunks: RetrievedChunk[];
  chat: ChatConfig;
  generate?: GenerateChatFn;
  abortSignal?: AbortSignal;
}): Promise<AgentVerifyResult> {
  const bind = bindCitationsToTurnEvidence(opts.answer, opts.chunks.length);
  if (!bind.ok) {
    return {
      passed: false,
      unavailable: false,
      reason: bind.reason,
      usage: emptyProviderUsage(),
    };
  }

  // Pure social / no factual citations: skip Layer C.
  if (opts.chunks.length === 0 && !/\[[1-9]\d*\]/.test(opts.answer)) {
    return {
      passed: true,
      unavailable: false,
      reason: "No factual citations to verify.",
      usage: emptyProviderUsage(),
    };
  }

  if (opts.abortSignal?.aborted) {
    return {
      passed: false,
      unavailable: true,
      reason: "Verification aborted.",
      usage: emptyProviderUsage(),
    };
  }

  const generate = opts.generate ?? generateChat;
  try {
    const { text: raw, usage } = await runGenerateChat(generate, {
      config: opts.chat,
      system:
        'You verify whether an answer is supported by the numbered sources, including qualifications and calculations. Return ONLY JSON like {"pass":true,"reason":"..."}. Fail if any factual claim is not supported by its cited source.',
      prompt: [
        `Question: ${opts.question}`,
        `Sources:\n${buildContextBlocks(opts.chunks)}`,
        `Answer:\n${opts.answer}`,
        "Fail if the answer invents facts, overstates qualifications, or cites a source that does not support the claim.",
      ].join("\n\n"),
    });
    const verdict = parseVerifierResponse(raw);
    return { passed: verdict.passed, unavailable: false, reason: verdict.reason, usage };
  } catch {
    return {
      passed: false,
      unavailable: true,
      reason: "Verifier unavailable.",
      usage: emptyProviderUsage(),
    };
  }
}

export function verifyUsageRecord(
  chat: ChatConfig,
  usage: ProviderUsage,
  turnId: string,
): ProviderUsageRecord {
  return {
    kind: "chat_completion",
    provider: chat.provider,
    model: chat.model,
    usage,
    step: "verify_answer",
    eventId: `${turnId}:verify_answer`,
  };
}
