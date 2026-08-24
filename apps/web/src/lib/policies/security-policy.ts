import type { SecuritySettings } from "@chatai/database";

import type { Env } from "@/lib/env";

import {
  isOriginAllowed,
  requestOriginHostname,
} from "./checks/domain-allowlist";
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

/**
 * Shared widget security gate.
 * Task 2: domain allowlist. Later tasks chain rate limit → bot → signature.
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

    return null;
  }
}
