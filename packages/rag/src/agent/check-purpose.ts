import {
  emptyProviderUsage,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
} from "@chatai/ai";

import type { ProviderUsageRecord } from "../answer/provider-usage";
import {
  renderPurposeBlock,
  templateRedirect,
  type ScopeProfile,
} from "../answer/scope";

export type PurposeJudgeDecision = "in_scope" | "out_of_scope" | "uncertain";
export type PurposeJudgeConfidence = "high" | "low";

export type PurposeJudgeResult = {
  decision: PurposeJudgeDecision;
  confidence: PurposeJudgeConfidence;
  rationale: string;
  mixed?: boolean;
  usage: ProviderUsage;
  unavailable: boolean;
};

/**
 * Structured Purpose judge — never returns user-facing invitation copy.
 * Defense in depth; not guaranteed semantic enforcement.
 */
export async function checkPurpose(opts: {
  request: string;
  draft?: string;
  reason: "agent_uncertain" | "server_pre_output";
  profile: ScopeProfile;
  chat: ChatConfig;
  generate?: GenerateChatFn;
  abortSignal?: AbortSignal;
}): Promise<PurposeJudgeResult> {
  if (opts.abortSignal?.aborted) {
    return {
      decision: "uncertain",
      confidence: "low",
      rationale: "aborted",
      usage: emptyProviderUsage(),
      unavailable: true,
    };
  }

  const generate = opts.generate ?? generateChat;
  try {
    const { text: raw, usage } = await runGenerateChat(generate, {
      config: opts.chat,
      system: [
        "You are a scope judge. Decide whether the user request and optional draft answer stay within the assistant Purpose.",
        'Return ONLY JSON: {"decision":"in_scope"|"out_of_scope"|"uncertain","confidence":"high"|"low","rationale":"...","mixed":false}',
        "Never write a user-facing reply or invitation. decision is about commercial topic fit, not auth/privacy.",
        "mixed=true when part of the request is in scope and part is not.",
      ].join("\n"),
      prompt: [
        `Judge reason: ${opts.reason}`,
        `Purpose:\n${renderPurposeBlock(opts.profile).slice(0, 2000)}`,
        `User request:\n${opts.request}`,
        ...(opts.draft ? [`Draft answer:\n${opts.draft.slice(0, 4000)}`] : []),
      ].join("\n\n"),
    });
    return { ...parsePurposeJudge(raw), usage, unavailable: false };
  } catch {
    return {
      decision: "uncertain",
      confidence: "low",
      rationale: "Purpose judge unavailable.",
      usage: emptyProviderUsage(),
      unavailable: true,
    };
  }
}

export function parsePurposeJudge(raw: string): Omit<PurposeJudgeResult, "usage" | "unavailable"> {
  try {
    const parsed = JSON.parse(raw.trim()) as {
      decision?: unknown;
      confidence?: unknown;
      rationale?: unknown;
      mixed?: unknown;
    };
    const decision =
      parsed.decision === "in_scope" || parsed.decision === "out_of_scope" || parsed.decision === "uncertain"
        ? parsed.decision
        : "uncertain";
    const confidence = parsed.confidence === "high" ? "high" : "low";
    return {
      decision,
      confidence,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 400) : decision,
      ...(parsed.mixed === true ? { mixed: true } : {}),
    };
  } catch {
    return {
      decision: "uncertain",
      confidence: "low",
      rationale: "Unparseable purpose judge output.",
    };
  }
}

export type PurposeDeliveryAction =
  | { action: "deliver" }
  | { action: "redirect"; text: string }
  | { action: "limit"; text: string };

/**
 * Decision table for Purpose judge outcomes (commercial topic only).
 * Never auto-injects the legacy Purpose invitation string.
 */
export function applyPurposeDecision(
  result: Pick<PurposeJudgeResult, "decision" | "confidence" | "unavailable">,
  profile: ScopeProfile,
): PurposeDeliveryAction {
  if (result.unavailable) {
    return { action: "limit", text: domainLimitation(profile) };
  }
  if (result.decision === "in_scope") {
    return { action: "deliver" };
  }
  if (result.decision === "out_of_scope" && result.confidence === "high") {
    return { action: "redirect", text: domainLimitation(profile) };
  }
  // out_of_scope low confidence, or uncertain → short domain limitation (not the contested draft)
  return { action: "limit", text: domainLimitation(profile) };
}

/** Agent-composed domain limitation — not the canned invite loop string. */
export function domainLimitation(profile: ScopeProfile): string {
  const redirect = templateRedirect(profile).trim();
  if (redirect && !/feel free to ask/i.test(redirect)) return redirect;
  if (profile.purpose?.trim()) {
    return `I can help with ${profile.purpose.trim().replace(/\.$/, "")}. What would you like to know about that?`;
  }
  return "I can only help with topics this assistant is set up for. What would you like to know within that area?";
}

export function purposeUsageRecord(
  chat: ChatConfig,
  usage: ProviderUsage,
  turnId: string,
): ProviderUsageRecord {
  return {
    kind: "chat_completion",
    provider: chat.provider,
    model: chat.model,
    usage,
    step: "check_purpose",
    eventId: `${turnId}:check_purpose`,
  };
}
