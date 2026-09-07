import { sql } from "@chatai/database";

import { db } from "@/lib/db";

export type ReserveUsageResult =
  | {
      ok: true;
      balanceId: string;
      consumedMicros: number;
      reservedMicros: number;
      limitMicros: number;
      estimateMicros: number;
    }
  | { ok: false; reason: "limit_exceeded" | "balance_missing" };

/**
 * Atomically reserve estimated cost against the period balance.
 * Concurrent callers cannot oversubscribe the limit.
 */
export async function reserveUsage(input: {
  accountId: string;
  periodStart: Date;
  estimateMicros: number;
}): Promise<ReserveUsageResult> {
  const estimate = Math.max(0, Math.floor(input.estimateMicros));
  if (estimate === 0) {
    const [row] = await db().execute<{
      id: string;
      consumed_micros: number;
      reserved_micros: number;
      limit_micros: number;
    }>(sql`
      SELECT id, consumed_micros, reserved_micros, limit_micros
      FROM usage_period_balances
      WHERE account_id = ${input.accountId}
        AND period_start = ${input.periodStart.toISOString()}
      LIMIT 1
    `);
    if (!row) {
      return { ok: false, reason: "balance_missing" };
    }
    return {
      ok: true,
      balanceId: row.id,
      consumedMicros: Number(row.consumed_micros),
      reservedMicros: Number(row.reserved_micros),
      limitMicros: Number(row.limit_micros),
      estimateMicros: 0,
    };
  }

  const [row] = await db().execute<{
    id: string;
    consumed_micros: number;
    reserved_micros: number;
    limit_micros: number;
  }>(sql`
    UPDATE usage_period_balances
    SET
      reserved_micros = reserved_micros + ${estimate},
      updated_at = now()
    WHERE account_id = ${input.accountId}
      AND period_start = ${input.periodStart.toISOString()}
      AND consumed_micros + reserved_micros + ${estimate} <= limit_micros
    RETURNING id, consumed_micros, reserved_micros, limit_micros
  `);

  if (!row) {
    const [exists] = await db().execute<{ id: string }>(sql`
      SELECT id
      FROM usage_period_balances
      WHERE account_id = ${input.accountId}
        AND period_start = ${input.periodStart.toISOString()}
      LIMIT 1
    `);
    return { ok: false, reason: exists ? "limit_exceeded" : "balance_missing" };
  }

  return {
    ok: true,
    balanceId: row.id,
    consumedMicros: Number(row.consumed_micros),
    reservedMicros: Number(row.reserved_micros),
    limitMicros: Number(row.limit_micros),
    estimateMicros: estimate,
  };
}

/**
 * Release reserved micros and optionally commit actual consumption.
 * Safe if called with reservedMicros=0 / actualMicros=0.
 */
export async function reconcileUsage(input: {
  accountId: string;
  periodStart: Date;
  reservedMicros: number;
  actualMicros: number;
  incrementRequestCount?: boolean;
}): Promise<void> {
  const reserved = Math.max(0, Math.floor(input.reservedMicros));
  const actual = Math.max(0, Math.floor(input.actualMicros));
  const bumpRequest = input.incrementRequestCount ? 1 : 0;

  if (reserved === 0 && actual === 0 && bumpRequest === 0) {
    return;
  }

  await db().execute(sql`
    UPDATE usage_period_balances
    SET
      reserved_micros = GREATEST(0, reserved_micros - ${reserved}),
      consumed_micros = consumed_micros + ${actual},
      request_count = request_count + ${bumpRequest},
      updated_at = now()
    WHERE account_id = ${input.accountId}
      AND period_start = ${input.periodStart.toISOString()}
  `);
}

/** Convenience: release a reservation with no consumption (provider failed / aborted). */
export async function releaseUsage(input: {
  accountId: string;
  periodStart: Date;
  reservedMicros: number;
}): Promise<void> {
  await reconcileUsage({
    accountId: input.accountId,
    periodStart: input.periodStart,
    reservedMicros: input.reservedMicros,
    actualMicros: 0,
    incrementRequestCount: false,
  });
}
