import type { ChatConfig, GenerateChatFn, ProviderUsage } from "@chatai/ai";

import {
  hasInjectionSignal,
  purposeInvite,
  templateRedirect,
  validateRedirect,
  type ScopeDecision,
  type ScopeProfile,
} from "./scope";
import {
  isSocialProtocolTurn,
  isVagueHelpRequest,
  planTurn,
  type ChatHistoryMessage,
  type TurnKind,
} from "./turn-plan";

/**
 * The Scope Router is the single authority on whether a turn is within the
 * assistant's Purpose, for Text and Voice. Generation never re-decides scope:
 * prompt builders require an `AuthorizedTurn`, which only `authorize` can produce,
 * and an "out" verdict cannot be authorized.
 */

export type ScopeVerdict = {
  decision: ScopeDecision;
  kind: "substantive" | "social" | "vague_help";
  /** Pipeline route for an authorized turn. */
  route: TurnKind;
  /** Standalone request the answer may address; only the in-scope part when partial. */
  authorizedRequest: string;
  /** Reply for "out" (owner redirect, validated classifier redirect, or template). */
  redirect?: string;
  redirectSource?: "purpose" | "classifier" | "template";
  /** Deterministic Purpose invitation for a vague help request. */
  invite?: string;
  injectionSuspected: boolean;
  /** The classifier failed or returned unusable output ("unknown"). */
  classifierFallback: boolean;
  timings: { plannerMs?: number };
  usage?: ProviderUsage;
};

declare const authorizedBrand: unique symbol;

/** Proof that the Scope Router authorized this turn. Only `authorize` creates one. */
export type AuthorizedTurn = {
  readonly [authorizedBrand]: true;
  readonly decision: "in" | "partial" | "unknown";
  readonly kind: ScopeVerdict["kind"];
  /** The only request text generation may address. */
  readonly request: string;
  readonly partial: boolean;
  /** Sources-only rules (classifier failure or an injection signal), whatever the mode. */
  readonly restricted: boolean;
};

export function authorize(verdict: ScopeVerdict): AuthorizedTurn | null {
  if (verdict.decision === "out") return null;
  return {
    decision: verdict.decision,
    kind: verdict.kind,
    request: verdict.authorizedRequest,
    partial: verdict.decision === "partial",
    restricted: verdict.decision === "unknown" || verdict.injectionSuspected,
  } as AuthorizedTurn;
}

/** Owner redirect first, then a validated classifier redirect, then the template. */
export function resolveRedirect(
  profile: ScopeProfile,
  classifierRedirect: string | undefined,
  message: string,
): { text: string; source: "purpose" | "classifier" | "template" } {
  if (profile.redirect) return { text: profile.redirect, source: "purpose" };
  const validated = validateRedirect(classifierRedirect, { message, profile });
  return validated ? { text: validated, source: "classifier" } : { text: templateRedirect(profile), source: "template" };
}

export async function routeScope(opts: {
  message: string;
  history: ChatHistoryMessage[];
  chat: ChatConfig;
  profile: ScopeProfile;
  generate?: GenerateChatFn;
  /** A deterministic social turn decided by the caller (e.g. "why did voice end?"). */
  forceSocial?: boolean;
}): Promise<ScopeVerdict> {
  const base = { injectionSuspected: false, classifierFallback: false, timings: {} };
  if (opts.forceSocial || isSocialProtocolTurn(opts.message, opts.history)) {
    return { ...base, decision: "in", kind: "social", route: "conversational", authorizedRequest: opts.message };
  }
  if (isVagueHelpRequest(opts.message)) {
    return {
      ...base,
      decision: "in",
      kind: "vague_help",
      route: "conversational",
      authorizedRequest: opts.message,
      invite: purposeInvite(opts.profile),
    };
  }

  const injectionSuspected = hasInjectionSignal(opts.message);
  const plan = await planTurn({
    message: opts.message,
    history: opts.history,
    chat: opts.chat,
    generate: opts.generate,
    scope: opts.profile,
    injectionSuspected,
  });
  const verdict: ScopeVerdict = {
    decision: plan.scope,
    kind: plan.invite ? "vague_help" : "substantive",
    route: plan.kind,
    authorizedRequest: plan.scope === "unknown" ? opts.message : plan.query,
    injectionSuspected,
    classifierFallback: plan.scope === "unknown",
    timings: plan.plannerMs !== undefined ? { plannerMs: plan.plannerMs } : {},
    ...(plan.usage ? { usage: plan.usage } : {}),
  };
  if (plan.invite) verdict.invite = purposeInvite(opts.profile);
  if (plan.scope === "out") {
    const redirect = resolveRedirect(opts.profile, plan.redirect, opts.message);
    verdict.redirect = redirect.text;
    verdict.redirectSource = redirect.source;
  }
  return verdict;
}
