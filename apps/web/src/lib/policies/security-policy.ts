import type { SecuritySettings } from "@chatai/database";

import type { Env } from "@/lib/env";

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
 * Shared widget security gate. Task 1 skeleton: `enforceWidgetRequest` is a no-op
 * pass-through. Tasks 2–5 add domain → rate limit → bot → signature checks.
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
   * Currently always allows (Task 1 stub). Later tasks chain checks here.
   */
  async enforceWidgetRequest(
    _request: Request,
    _ctx: WidgetRequestContext,
  ): Promise<PolicyViolation | null> {
    return null;
  }
}
