import type { HostingAccount } from "./accounts";
import { checkHostingAccountAccess } from "./accounts";
import { resolveEffectiveLimitMicros } from "./entitlements";
import { getOrCreateUsagePeriodBalance } from "./period-balance";
import { resolveAccountEntitlements } from "./plan-entitlements";

export type EvalAccessResult =
  | { ok: true }
  | {
      ok: false;
      status: 402 | 403;
      code: "EVALS_NOT_INCLUDED" | "ACCOUNT_INACTIVE" | "USAGE_LIMIT_REACHED";
      error: string;
    };

/**
 * Gate eval-run creation: plan feature + account status + remaining budget preflight.
 * Does not fully reserve/meter eval tokens (documented residual risk for paid tiers).
 */
export async function assertEvalAccess(account: HostingAccount): Promise<EvalAccessResult> {
  const access = checkHostingAccountAccess(account);
  if (!access.ok) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_INACTIVE",
      error: access.error,
    };
  }

  const entitlements = await resolveAccountEntitlements(account);
  if (!entitlements.evalsEnabled) {
    return {
      ok: false,
      status: 403,
      code: "EVALS_NOT_INCLUDED",
      error:
        "Evaluation tools are not included on your current plan. Upgrade to Pro or Business to run evals.",
    };
  }

  const balance = await getOrCreateUsagePeriodBalance(account);
  const limit = await resolveEffectiveLimitMicros(account);
  const remaining = Math.max(0, limit - balance.consumedMicros - balance.reservedMicros);
  if (remaining <= 0) {
    return {
      ok: false,
      status: 402,
      code: "USAGE_LIMIT_REACHED",
      error:
        "You've reached your monthly hosted AI allowance. Upgrade your plan or wait until your usage period resets.",
    };
  }

  return { ok: true };
}
