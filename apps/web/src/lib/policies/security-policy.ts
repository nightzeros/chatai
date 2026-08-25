import type { SecuritySettings } from "@chatai/database";

import type { Env } from "@/lib/env";

import { evaluateBotHeuristics, type BotCheckInput } from "./checks/bot-heuristics";
import {
  isOriginAllowed,
  requestOriginHostname,
} from "./checks/domain-allowlist";
import {
  consumeWidgetRateLimits,
  type ConsumeWidgetRateLimitsInput,
} from "./checks/widget-rate-limit";
import {
  verifyWidgetSignature,
  WIDGET_SIGNATURE_HEADER,
  type VerifyWidgetSignatureResult,
} from "./checks/widget-signature";
import type { PolicyViolation, WidgetRequestContext } from "./policy-violation";
import {
  resolveSecurityPolicy,
  type ResolvedSecurityPolicy,
  type SecurityPolicyEnv,
} from "./resolve-security-policy";

export type SecurityPolicyAssistant = {
  id: string;
  publicId: string;
  securitySettings?: SecuritySettings | null;
};

export type EnforceWidgetRequestDeps = {
  consumeRateLimits?: (
    input: ConsumeWidgetRateLimitsInput,
  ) => Promise<PolicyViolation | null>;
  evaluateBot?: (input: BotCheckInput) => { ok: true } | { ok: false; reason: string };
  verifySignature?: (input: {
    secret: string;
    assistantPublicId: string;
    visitorId: string;
    header: string | null;
    maxSkewSeconds: number;
  }) => VerifyWidgetSignatureResult;
};

/**
 * Shared widget security gate.
 * domain → rate limits → bot heuristics → optional HMAC signature.
 */
export class SecurityPolicy {
  readonly assistantId: string;
  readonly publicId: string;
  readonly resolved: ResolvedSecurityPolicy;

  private constructor(
    assistantId: string,
    publicId: string,
    resolved: ResolvedSecurityPolicy,
  ) {
    this.assistantId = assistantId;
    this.publicId = publicId;
    this.resolved = resolved;
  }

  static fromAssistant(
    assistant: SecurityPolicyAssistant,
    env: SecurityPolicyEnv | Env,
  ): SecurityPolicy {
    return new SecurityPolicy(
      assistant.id,
      assistant.publicId,
      resolveSecurityPolicy(assistant.securitySettings, env),
    );
  }

  /**
   * Returns `null` when the request is allowed.
   * Skips checks for playground traffic (owner dashboard).
   */
  async enforceWidgetRequest(
    request: Request,
    ctx: WidgetRequestContext,
    deps: EnforceWidgetRequestDeps = {},
  ): Promise<PolicyViolation | null> {
    if (ctx.source === "playground") {
      return null;
    }

    const hostname = requestOriginHostname(request);
    if (!isOriginAllowed(hostname, this.resolved.allowedDomains)) {
      return {
        status: 403,
        message: "Origin not allowed.",
        reason: hostname
          ? `origin_denied:${hostname}`
          : "origin_missing_or_malformed",
      };
    }

    const consume = deps.consumeRateLimits ?? consumeWidgetRateLimits;
    const rateLimited = await consume({
      assistantId: this.assistantId,
      visitorId: ctx.visitorId,
      perVisitorLimit: this.resolved.widgetRateLimitPerVisitor,
      perAssistantLimit: this.resolved.widgetRateLimitPerAssistant,
    });
    if (rateLimited) {
      return rateLimited;
    }

    const evaluateBot = deps.evaluateBot ?? evaluateBotHeuristics;
    const bot = evaluateBot({
      assistantId: this.assistantId,
      visitorId: ctx.visitorId,
      message: ctx.message,
      userAgent: request.headers.get("user-agent"),
    });
    if (!bot.ok) {
      return {
        status: 403,
        message: "Request blocked.",
        reason: bot.reason,
      };
    }

    if (this.resolved.requireWidgetSigning && !ctx.skipSignatureCheck) {
      const needsSignature = ctx.message !== undefined || Boolean(ctx.visitorId);
      if (needsSignature) {
        if (!this.resolved.widgetSigningSecret) {
          return {
            status: 403,
            message: "Request blocked.",
            reason: "widget_signing_misconfigured",
          };
        }
        if (!ctx.visitorId) {
          return {
            status: 403,
            message: "Request blocked.",
            reason: "widget_signing_missing_visitor",
          };
        }

        const verify = deps.verifySignature ?? ((input) =>
          verifyWidgetSignature({
            ...input,
            maxSkewSeconds: this.resolved.signingMaxSkewSeconds,
          }));

        const verified = verify({
          secret: this.resolved.widgetSigningSecret,
          assistantPublicId: this.publicId,
          visitorId: ctx.visitorId,
          header: request.headers.get(WIDGET_SIGNATURE_HEADER),
          maxSkewSeconds: this.resolved.signingMaxSkewSeconds,
        });
        if (!verified.ok) {
          return {
            status: 403,
            message: "Request blocked.",
            reason: verified.reason,
          };
        }
      }
    }

    return null;
  }
}
