import { auditEvents, desc, eq, type AuditAction } from "@chatai/database";

export type AuditEventRow = {
  id: string;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export async function listAuditEventsForUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<AuditEventRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const { db } = await import("@/lib/db");
  const rows = await db()
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      resourceType: auditEvents.resourceType,
      resourceId: auditEvents.resourceId,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return rows;
}
