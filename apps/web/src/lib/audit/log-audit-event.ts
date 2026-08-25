import { auditEvents, type AuditAction } from "@chatai/database";

import { createId } from "../ids";

const SENSITIVE_KEY =
  /(password|secret|token|apikey|api[_-]?key|authorization|ciphertext|cookie|credential|encryption[_-]?key|signing[_-]?secret|bearer)/i;

/** Never store network addresses in audit metadata (v0.8 policy). */
const IP_KEY = /^(ip|ipaddress|ip_address|clientip|client_ip|xff|x[_-]?forwarded[_-]?for|remoteaddr|remote_addr)$/i;

export type LogAuditEventInput = {
  userId?: string | null;
  action: AuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively strip secrets / credentials / IPs from audit metadata.
 * Safe primitives and nested structures of safe values are preserved.
 */
export function sanitizeAuditMetadata(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditMetadata(entry));
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || IP_KEY.test(key)) {
      continue;
    }
    const sanitized = sanitizeAuditMetadata(child);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}

/**
 * Append-only audit write. Failures are logged and never thrown so callers
 * (auth, deletes, settings) are not blocked by audit storage issues.
 * There is no update/delete API for audit_events in application code.
 */
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const { db } = await import("@/lib/db");
    const metadata = sanitizeAuditMetadata(input.metadata ?? {});
    await db().insert(auditEvents).values({
      id: createId(),
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata: isPlainObject(metadata) ? metadata : {},
    });
  } catch (error) {
    console.error("[audit] failed to write event", input.action, error);
  }
}
