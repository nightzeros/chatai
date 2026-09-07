import { and, eq, lt, sql, usageEvents } from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

import { releaseUsage } from "./reservation";

/**
 * Release reserved balance micros for abandoned in-flight requests
 * (server crash, hung stream, etc.).
 *
 * Expects reservation parent events to store `metadata.periodStart` (ISO string)
 * and `reserved_cost_micros > 0` with `status = 'reserved'`.
 *
 * Claims the event row first (`status → abandoned`) so concurrent ticks cannot
 * double-release; balance release runs after a successful claim.
 */
export async function reconcileStaleReservations(opts?: {
  olderThanMinutes?: number;
  now?: Date;
}): Promise<number> {
  const olderThanMinutes =
    opts?.olderThanMinutes ?? env.HOSTED_USAGE_RECONCILE_STALE_MINUTES;
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanMinutes * 60_000);

  const rows = await db()
    .select({
      id: usageEvents.id,
      accountId: usageEvents.accountId,
      reservedCostMicros: usageEvents.reservedCostMicros,
      metadata: usageEvents.metadata,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.status, "reserved"),
        lt(usageEvents.createdAt, cutoff),
        sql`${usageEvents.reservedCostMicros} > 0`,
      ),
    )
    .limit(100);

  let released = 0;

  for (const row of rows) {
    const periodStartRaw = row.metadata?.periodStart;
    if (typeof periodStartRaw !== "string") {
      console.error("[usage] stale reservation missing metadata.periodStart", {
        eventId: row.id,
      });
      continue;
    }

    const periodStart = new Date(periodStartRaw);
    const reserved = Number(row.reservedCostMicros) || 0;

    try {
      const claimed = await db()
        .update(usageEvents)
        .set({
          status: "abandoned",
          completedAt: now,
          errorCode: "stale_reservation",
          metadata: {
            ...row.metadata,
            abandonedBy: "stale_reconciler",
            abandonedAt: now.toISOString(),
          },
        })
        .where(and(eq(usageEvents.id, row.id), eq(usageEvents.status, "reserved")))
        .returning({ id: usageEvents.id });

      if (claimed.length === 0) {
        continue;
      }

      await releaseUsage({
        accountId: row.accountId,
        periodStart,
        reservedMicros: reserved,
      });

      released += 1;
    } catch (error) {
      console.error("[usage] Failed to abandon stale reservation", {
        eventId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (released > 0) {
    console.info("[usage] reconciliation.abandoned", { count: released });
  }

  return released;
}

const POLL_MS = 60_000;

type GlobalWorker = typeof globalThis & { __chataiUsageReconcileWorker?: boolean };

export function startUsageReconcileWorker() {
  const g = globalThis as GlobalWorker;
  if (g.__chataiUsageReconcileWorker) return;
  g.__chataiUsageReconcileWorker = true;

  const tick = async () => {
    try {
      await reconcileStaleReservations();
    } catch (error) {
      console.error("[usage] stale reconciler tick failed:", error);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, POLL_MS);
}
