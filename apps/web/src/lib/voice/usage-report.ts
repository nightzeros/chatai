import {
  and,
  assistants,
  count,
  eq,
  inArray,
  sql,
  usagePeriodBalances,
  voiceSessions,
  type ConversationSource,
  type VoiceMeteringMode,
} from "@chatai/database";

import { db } from "@/lib/db";
import type { HostingAccount } from "@/lib/hosting/accounts";
import { getOrCreateUsagePeriodBalance } from "@/lib/hosting/period-balance";

import { voiceMeteringMode } from "./quota";

/**
 * Owner-facing Voice minutes. Minutes come from settled/estimated `voice_sessions`
 * rows (so they work in every enforcement mode); quota state comes from the period
 * balance. Provider cost is never part of this report.
 */
export type VoiceUsageReport = {
  mode: VoiceMeteringMode;
  periodStart: string;
  periodEnd: string;
  /** Seconds counted toward the entitlement this period. */
  countedSeconds: number;
  /** null = unlimited. */
  limitSeconds: number | null;
  reservedSeconds: number;
  /** 0–100, null when unlimited. */
  usagePercent: number | null;
  /** All measured seconds, including quota-exempt Playground. */
  totalSeconds: number;
  playgroundSeconds: number;
  /** Playground seconds did not count toward the quota. */
  playgroundExempt: boolean;
  /** Seconds settled from a checkpoint (crash recovery) rather than provider-final. */
  estimatedSeconds: number;
  sessionCount: number;
  inProgressSessions: number;
  bySource: Array<{ source: ConversationSource; seconds: number; sessions: number; quotaExempt: boolean }>;
  byAssistant: Array<{
    assistantId: string;
    assistantName: string | null;
    seconds: number;
    sessions: number;
  }>;
};

type UsagePeriodBalance = typeof usagePeriodBalances.$inferSelect;

const MEASURED = ["settled", "estimated"] as const;

type SessionAggregate = {
  source: ConversationSource;
  quotaExempt: boolean;
  assistantId: string;
  meteringStatus: string;
  seconds: number;
  sessions: number;
};

async function aggregatePeriodSessions(
  accountId: string,
  periodStart: Date,
  assistantId?: string,
): Promise<SessionAggregate[]> {
  const rows = await db()
    .select({
      source: voiceSessions.source,
      quotaExempt: voiceSessions.quotaExempt,
      assistantId: voiceSessions.assistantId,
      meteringStatus: voiceSessions.meteringStatus,
      seconds: sql<number>`cast(coalesce(sum(${voiceSessions.voiceSeconds}), 0) as int)`,
      sessions: count(),
    })
    .from(voiceSessions)
    .where(
      and(
        eq(voiceSessions.hostingAccountId, accountId),
        eq(voiceSessions.usagePeriodStart, periodStart),
        inArray(voiceSessions.meteringStatus, [...MEASURED]),
        assistantId ? eq(voiceSessions.assistantId, assistantId) : undefined,
      ),
    )
    .groupBy(
      voiceSessions.source,
      voiceSessions.quotaExempt,
      voiceSessions.assistantId,
      voiceSessions.meteringStatus,
    );
  return rows.map((row) => ({
    ...row,
    seconds: Number(row.seconds) || 0,
    sessions: Number(row.sessions) || 0,
  }));
}

export function summarizeVoiceUsage(input: {
  mode: VoiceMeteringMode;
  balance: Pick<
    UsagePeriodBalance,
    "periodStart" | "periodEnd" | "voiceSecondsLimit" | "voiceSecondsReserved" | "voiceSecondsConsumed"
  >;
  aggregates: SessionAggregate[];
  assistantNames: Map<string, string | null>;
  inProgressSessions: number;
}): VoiceUsageReport {
  const { balance, aggregates, mode } = input;
  const sum = (rows: SessionAggregate[]) => rows.reduce((acc, row) => acc + row.seconds, 0);

  const counted = aggregates.filter((row) => !row.quotaExempt);
  const playground = aggregates.filter((row) => row.source === "playground");
  // In enforce mode the balance is authoritative (it also covers deleted assistants).
  const countedSeconds =
    mode === "enforce" ? Math.max(balance.voiceSecondsConsumed, 0) : sum(counted);

  const bySource = new Map<string, VoiceUsageReport["bySource"][number]>();
  const byAssistant = new Map<string, VoiceUsageReport["byAssistant"][number]>();
  for (const row of aggregates) {
    const sourceKey = `${row.source}:${row.quotaExempt}`;
    const source = bySource.get(sourceKey) ?? {
      source: row.source,
      seconds: 0,
      sessions: 0,
      quotaExempt: row.quotaExempt,
    };
    source.seconds += row.seconds;
    source.sessions += row.sessions;
    bySource.set(sourceKey, source);

    const assistant = byAssistant.get(row.assistantId) ?? {
      assistantId: row.assistantId,
      assistantName: input.assistantNames.get(row.assistantId) ?? null,
      seconds: 0,
      sessions: 0,
    };
    assistant.seconds += row.seconds;
    assistant.sessions += row.sessions;
    byAssistant.set(row.assistantId, assistant);
  }

  const limit = balance.voiceSecondsLimit;
  return {
    mode,
    periodStart: balance.periodStart.toISOString(),
    periodEnd: balance.periodEnd.toISOString(),
    countedSeconds,
    limitSeconds: limit,
    reservedSeconds: mode === "enforce" ? balance.voiceSecondsReserved : 0,
    usagePercent:
      limit == null
        ? null
        : limit <= 0
          ? countedSeconds > 0
            ? 100
            : 0
          : Math.min(100, Math.round((countedSeconds / limit) * 1000) / 10),
    totalSeconds: sum(aggregates),
    playgroundSeconds: sum(playground),
    playgroundExempt: playground.some((row) => row.quotaExempt),
    estimatedSeconds: sum(aggregates.filter((row) => row.meteringStatus === "estimated")),
    sessionCount: aggregates.reduce((acc, row) => acc + row.sessions, 0),
    inProgressSessions: input.inProgressSessions,
    bySource: [...bySource.values()].sort((a, b) => b.seconds - a.seconds),
    byAssistant: [...byAssistant.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

export async function getVoiceUsageReport(
  account: HostingAccount,
  now = new Date(),
): Promise<VoiceUsageReport> {
  const balance = await getOrCreateUsagePeriodBalance(account, now);
  const aggregates = await aggregatePeriodSessions(account.id, balance.periodStart);

  const assistantIds = [...new Set(aggregates.map((row) => row.assistantId))];
  const names =
    assistantIds.length > 0
      ? await db()
          .select({ id: assistants.id, name: assistants.name })
          .from(assistants)
          .where(inArray(assistants.id, assistantIds))
      : [];

  const [open] = await db()
    .select({ value: count() })
    .from(voiceSessions)
    .where(and(eq(voiceSessions.hostingAccountId, account.id), eq(voiceSessions.meteringStatus, "open")));

  return summarizeVoiceUsage({
    mode: voiceMeteringMode(),
    balance,
    aggregates,
    assistantNames: new Map(names.map((row) => [row.id, row.name])),
    inProgressSessions: Number(open?.value ?? 0),
  });
}

/** Measured Voice seconds for one assistant in the account's current period. */
export async function getAssistantVoiceSeconds(
  account: HostingAccount,
  assistantId: string,
  now = new Date(),
): Promise<{ seconds: number; playgroundSeconds: number; sessions: number }> {
  const balance = await getOrCreateUsagePeriodBalance(account, now);
  const aggregates = await aggregatePeriodSessions(account.id, balance.periodStart, assistantId);
  return {
    seconds: aggregates.reduce((acc, row) => acc + row.seconds, 0),
    playgroundSeconds: aggregates
      .filter((row) => row.source === "playground")
      .reduce((acc, row) => acc + row.seconds, 0),
    sessions: aggregates.reduce((acc, row) => acc + row.sessions, 0),
  };
}
