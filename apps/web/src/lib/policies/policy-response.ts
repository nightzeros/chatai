import type { PolicyViolation } from "@/lib/policies/policy-violation";
import { jsonWithCors } from "@/lib/cors";

export function policyViolationResponse(violation: PolicyViolation) {
  return jsonWithCors(
    { error: violation.message },
    { status: violation.status, headers: violation.headers },
  );
}
