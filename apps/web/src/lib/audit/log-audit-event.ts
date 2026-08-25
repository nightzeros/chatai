import { auditEvents, type AuditAction } from "@chatai/database";

import { createId } from "../ids";

const SENSITIVE_KEY =
  /^(.*)?(password|secret|token|apikey|api_key|authorization|ciphertext|cookie|credential)(.*)?$/i;

export type LogAuditEventInput = {
  userId?: string | null;
  action: AuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Strip secrets / credentials from audit metadata.
 * Never store IP addresses (v0.8 policy) or raw secrets.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
      out[key] = value;
      continue;
    }
    // Drop nested objects rather than risk leaking nested secrets.
  }
  return out;
}

/**
 * Append-only audit write. Failures are logged and never thrown so callers
 * (auth, deletes, settings) are not blocked by audit storage issues.
 */
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    await db().insert(auditEvents).values({
      id: createId(),
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: sanitizeAuditMetadata(input.metadata ?? {}),
    });
  } catch (error) {
    console.error("[audit] failed to write event", input.action, error);
  }
}
