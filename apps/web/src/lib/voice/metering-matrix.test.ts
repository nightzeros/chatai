import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ModelPricingRow } from "@chatai/billing";
import {
  assistants,
  eq,
  hostingAccounts,
  resolveEffectiveVoicePersistence,
  sql,
  usageEvents,
  usagePeriodBalances,
  user,
  voiceRecordings,
  voiceSessions,
  type Database,
  type HostingPlanCode,
  type PrivacySettings,
  type VoiceSettings,
} from "@chatai/database";
import { createTestDatabase } from "@chatai/database/testing";
import { MockRealtimeVoiceProvider, type MockControlChannel } from "@chatai/voice/mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  env: {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    VOICE_PROVIDER: "mock",
    VOICE_RECORDING_SPOOL_DIR: "",
    HOSTED_USAGE_ENFORCEMENT: "enforce" as "enforce" | "shadow" | "off",
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000,
    HOSTED_USAGE_RECONCILE_STALE_MINUTES: 15,
    VOICE_QUOTA_EXEMPT_PLAYGROUND: true,
    VOICE_MAX_CONCURRENT_SESSIONS: undefined as number | undefined,
  },
}));

vi.mock("@/lib/db", () => ({ db: () => state.db }));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/env", () => ({ env: state.env }));

import { listAdminHostingAccounts } from "@/lib/hosting/admin-accounts";
import { getOrCreateUsagePeriodBalance } from "@/lib/hosting/period-balance";
import {
  getRecentUsageEvents,
  getUsageByAssistant,
  getUsageByModel,
  getUsageSummary,
} from "@/lib/hosting/usage-reports";
import { reconcileStaleReservations } from "@/lib/hosting/stale-reservations";
import { createId } from "@/lib/ids";
import { createMemoryObjectStorage } from "@/lib/storage/memory";
import { setObjectStorageForTests } from "@/lib/storage/object-storage";

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import {
  createVoiceMeter,
  setVoiceMeterAutoTickForTests,
  setVoiceMeterClockForTests,
  tickVoiceMeter,
  VOICE_LIMIT_WARNING_INSTRUCTIONS,
} from "./enforcement";
import {
  clearEndedVoiceSessionsForTests,
  supersedeVisitorVoiceSessions,
  terminateVoiceSession,
} from "./lifecycle";
import {
  checkpointVoiceUsage,
  computeVoiceSeconds,
  markVoiceProviderCreated,
  settleVoiceUsage,
} from "./metering";
import { createVoiceConversation, insertDurableVoiceSessionRow, insertOperationalVoiceSessionRow } from "./persist";
import { admitVoiceSession, extendVoiceGrant, releaseVoiceAdmission } from "./quota";
import {
  endVoiceSessionsForAssistant,
  recoverOrphanedVoiceSession,
  recoverOrphanedVoiceSessions,
} from "./recovery";
import { startVoiceRecording } from "./recording/service";
import {
  clearVoiceRuntimeForTests,
  getVoiceRuntime,
  registerVoiceRuntime,
  type VoiceRuntimeSession,
} from "./session-runtime";
import { superviseSideband } from "./sideband-supervisor";
import { getAssistantVoiceSeconds, getVoiceUsageReport } from "./usage-report";
import { formatVoiceDuration } from "./duration-format";

let db: Database;
let close: () => Promise<void>;
let seq = 0;
let nowMs = Date.now();

const HOUR_MS = 3_600_000;

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(
  opts: {
    plan?: HostingPlanCode;
    privacy?: PrivacySettings;
    voice?: VoiceSettings;
  } = {},
) {
  seq += 1;
  const userId = `user_${seq}`;
  const accountId = `acct_${seq}`;
  const assistantId = `asst_${seq}`;
  const privacySettings = opts.privacy ?? { storeConversations: true };
  const voiceSettings = opts.voice ?? { enabled: true, saveTranscripts: true };
  await db.insert(user).values({ id: userId, name: "Owner", email: `owner${seq}@example.com` });
  await db.insert(hostingAccounts).values({
    id: accountId,
    userId,
    planCode: opts.plan ?? "pro",
    periodAnchor: new Date("2026-01-01T00:00:00Z"),
  });
  await db.insert(assistants).values({
    id: assistantId,
    publicId: `pub_${seq}`,
    userId,
    name: "Voice Bot",
    privacySettings,
    voiceSettings,
  });
  const [account] = await db.select().from(hostingAccounts).where(eq(hostingAccounts.id, accountId));
  return { userId, accountId, assistantId, account: account!, privacySettings, voiceSettings };
}

/** Pin the current period's Voice entitlement (null = unlimited). */
async function setVoiceBalance(s: Seed, limit: number | null, consumed = 0) {
  const balance = await getOrCreateUsagePeriodBalance(s.account);
  await db
    .update(usagePeriodBalances)
    .set({ voiceSecondsLimit: limit, voiceSecondsConsumed: consumed, voiceSecondsReserved: 0 })
    .where(eq(usagePeriodBalances.id, balance.id));
}

async function balanceOf(s: Seed) {
  const [row] = await db
    .select()
    .from(usagePeriodBalances)
    .where(eq(usagePeriodBalances.accountId, s.accountId));
  return row!;
}

async function sessionRow(sessionId: string) {
  const [row] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, sessionId));
  return row;
}

async function ledgerFor(sessionId: string) {
  return db.select().from(usageEvents).where(eq(usageEvents.requestId, sessionId));
}

async function admit(s: Seed, source: "widget" | "playground" | "api" = "widget", visitorId = "visitor01") {
  const sessionId = createId();
  const persistence = resolveEffectiveVoicePersistence(s.privacySettings, s.voiceSettings);
  const result = await admitVoiceSession({
    sessionId,
    assistantId: s.assistantId,
    account: s.account,
    source,
    visitorId,
    ephemeral: persistence.ephemeral,
    providerId: "gpt-live",
    model: "gpt-live-1",
    voiceId: "marin",
  });
  return { sessionId, result, persistence };
}

type Started = {
  sessionId: string;
  runtime: VoiceRuntimeSession;
  channel: MockControlChannel;
  provider: MockRealtimeVoiceProvider;
};

/** Mint path without HTTP: admission → provider create → meter → sideband → row → register. */
async function start(
  s: Seed,
  opts: {
    source?: "widget" | "playground" | "api";
    visitorId?: string;
    startedAgoMs?: number;
    provider?: MockRealtimeVoiceProvider;
    record?: boolean;
  } = {},
): Promise<Started> {
  const source = opts.source ?? "widget";
  const visitorId = opts.visitorId ?? "visitor01";
  const { sessionId, result, persistence } = await admit(s, source, visitorId);
  if (!result.ok) throw new Error(`admission refused: ${result.reason}`);

  const provider = opts.provider ?? new MockRealtimeVoiceProvider();
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: {
      model: "gpt-live-1",
      voice: "marin",
      delegationMode: "client",
    } as Parameters<typeof provider.createWebRtcSession>[0]["sessionConfig"],
  });
  const startedAt = new Date(Date.now() - (opts.startedAgoMs ?? HOUR_MS));
  await markVoiceProviderCreated({ sessionId, providerSessionId: created.providerSessionId, startedAt });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  const conversationId =
    !persistence.ephemeral && opts.record
      ? await createVoiceConversation({ assistantId: s.assistantId, visitorId, source })
      : null;

  const runtime = fakeVoiceRuntime({
    sessionId,
    providerSessionId: created.providerSessionId,
    assistantId: s.assistantId,
    source,
    visitorId,
    ephemeral: persistence.ephemeral,
    persistence,
    conversationId,
    channel,
    provider,
    providerId: "gpt-live",
    status: "connecting",
    startedAt,
    recordingConsentAt: opts.record ? new Date() : null,
    metering: createVoiceMeter(result.admission),
    endReason: null,
  });
  runtime.assistant!.hostingAccount = s.account;
  superviseSideband(runtime, channel);
  if (persistence.ephemeral) await insertOperationalVoiceSessionRow(runtime);
  else await insertDurableVoiceSessionRow(runtime);
  if (opts.record) await startVoiceRecording(runtime);
  registerVoiceRuntime(runtime);
  return { sessionId, runtime, channel, provider };
}

/** Media evidence (a visitor transcript) plus a cumulative provider usage snapshot. */
function talk(started: Started, usageSeconds: number) {
  started.channel.simulateInputTranscript("hello");
  started.channel.setUsageSeconds(usageSeconds);
}

async function endByClient(started: Started) {
  return terminateVoiceSession(started.runtime, {
    reason: "close_requested",
    requestProviderClose: true,
  });
}

/** Simulate process death: runtime gone, sideband listener gone, row still open. */
async function crash(started: Started, checkpointAgoMs = 5 * 60_000) {
  started.runtime.unsubscribe?.();
  started.runtime.unsubscribe = null;
  clearVoiceRuntimeForTests();
  await db
    .update(voiceSessions)
    .set({ usageCheckpointAt: new Date(Date.now() - checkpointAgoMs) })
    .where(eq(voiceSessions.id, started.sessionId));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
  state.env.VOICE_RECORDING_SPOOL_DIR = mkdtempSync(path.join(tmpdir(), "chatai-meter-spool-"));
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(() => {
  state.env.HOSTED_USAGE_ENFORCEMENT = "enforce";
  state.env.VOICE_QUOTA_EXEMPT_PLAYGROUND = true;
  state.env.VOICE_MAX_CONCURRENT_SESSIONS = undefined;
  nowMs = Date.now();
  setVoiceMeterClockForTests(() => nowMs);
  setVoiceMeterAutoTickForTests(false);
  clearVoiceRuntimeForTests();
  clearEndedVoiceSessionsForTests();
  setObjectStorageForTests(null);
});

afterEach(() => {
  setVoiceMeterClockForTests(null);
  setVoiceMeterAutoTickForTests(true);
});

describe("Voice-second computation", () => {
  const t0 = new Date("2026-09-27T10:00:00Z");
  const at = (s: number) => new Date(t0.getTime() + s * 1000);

  it("provider seconds are authoritative, rounded up, bounded by wall clock + init", () => {
    expect(
      computeVoiceSeconds({ providerSeconds: 90.2, startedAt: t0, endedAt: at(120), connected: true, providerSessionCreated: true }),
    ).toMatchObject({ voiceSeconds: 91, providerBillableSeconds: 91, anomaly: null });
    expect(
      computeVoiceSeconds({ providerSeconds: 500, startedAt: t0, endedAt: at(60), connected: true, providerSessionCreated: true }),
    ).toMatchObject({ voiceSeconds: 75, providerBillableSeconds: 500, anomaly: "wallclock_cap" });
  });

  it("never-connected sessions are 0 Voice seconds but keep the provider init minimum", () => {
    expect(
      computeVoiceSeconds({ providerSeconds: 3, startedAt: t0, endedAt: at(10), connected: false, providerSessionCreated: true }),
    ).toMatchObject({ voiceSeconds: 0, providerBillableSeconds: 15, neverConnected: true });
    expect(
      computeVoiceSeconds({ providerSeconds: 0, startedAt: t0, endedAt: at(10), connected: false, providerSessionCreated: false }),
    ).toMatchObject({ voiceSeconds: 0, providerBillableSeconds: 0 });
  });
});

describe("exactly-once settlement", () => {
  it("concurrent exits settle once: one ledger row, one balance change", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    talk(started, 120);

    await Promise.all([
      endByClient(started),
      settleVoiceUsage({ sessionId: started.sessionId, measurement: "provider_checkpoint", providerSeconds: 100 }),
      settleVoiceUsage({ sessionId: started.sessionId, measurement: "provider_final", providerSeconds: 120 }),
      recoverOrphanedVoiceSessions({ now: new Date(Date.now() + HOUR_MS * 3) }),
      terminateVoiceSession(started.runtime, { reason: "remote_hangup", requestProviderClose: false }),
    ]);

    const row = await sessionRow(started.sessionId);
    const ledger = await ledgerFor(started.sessionId);
    const balance = await balanceOf(s);
    expect(ledger).toHaveLength(1);
    expect(row?.meteringStatus).not.toBe("open");
    expect(row?.voiceSeconds).toBeGreaterThan(0);
    expect(balance.voiceSecondsConsumed).toBe(row?.voiceSeconds);
    expect(balance.voiceSecondsReserved).toBe(0);
    expect(ledger[0]?.idempotencyKey).toBe(`voice_realtime:${started.sessionId}`);
  });

  it("client end settles provider-final from session.closed", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    talk(started, 120);
    await endByClient(started);

    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({
      meteringStatus: "settled",
      usageMeasurement: "provider_final",
      voiceSeconds: 120,
      providerUsageSeconds: 120,
      billableSeconds: 120,
    });
    const [event] = await ledgerFor(started.sessionId);
    expect(event).toMatchObject({
      operation: "voice_realtime",
      provider: "openai",
      model: "gpt-live-1",
      units: 120,
      status: "completed",
      finalCostMicros: 100_000,
    });
    expect(event?.metadata).toMatchObject({ voiceSeconds: 120, providerUnit: "second", source: "widget" });
    expect((await balanceOf(s)).voiceSecondsConsumed).toBe(120);
  });

  it("a second settlement (any path) is a no-op", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 60);
    await endByClient(started);
    const again = await settleVoiceUsage({
      sessionId: started.sessionId,
      measurement: "provider_final",
      providerSeconds: 999,
    });
    expect(again).toBeNull();
    expect((await sessionRow(started.sessionId))?.voiceSeconds).toBe(60);
    expect(await ledgerFor(started.sessionId)).toHaveLength(1);
  });

  it("duplicate and out-of-order usage snapshots never inflate usage", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 60);
    started.channel.emit({ type: "usage.updated", seconds: 30 });
    started.channel.emit({ type: "usage.updated", seconds: 60 });
    started.channel.emit({ type: "usage.updated", seconds: 45 });
    expect(started.runtime.usageSeconds).toBe(60);
    expect(started.runtime.metering?.snapshotSeconds).toBe(60);
    await flush();
    expect((await sessionRow(started.sessionId))?.providerUsageSeconds).toBe(60);
    await checkpointVoiceUsage(started.sessionId, 20);
    expect((await sessionRow(started.sessionId))?.providerUsageSeconds).toBe(60);
  });

  it("an extension racing settlement never strands a reservation", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    talk(started, 50);
    await Promise.all([extendVoiceGrant(started.sessionId), endByClient(started)]);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
    expect(await extendVoiceGrant(started.sessionId)).toBe(0);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
  });

  it("the stale text-reservation sweeper ignores Voice rows", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 30);
    await endByClient(started);
    await db
      .update(usageEvents)
      .set({ status: "reserved", reservedCostMicros: 1000, createdAt: new Date(Date.now() - HOUR_MS) })
      .where(eq(usageEvents.requestId, started.sessionId));
    const released = await reconcileStaleReservations({ olderThanMinutes: 1 });
    expect(released).toBe(0);
    const [event] = await ledgerFor(started.sessionId);
    expect(event?.status).toBe("reserved");
  });
});

describe("admission and partial grants", () => {
  it("a partial 135 s grant warns once, then closes with usage_limit", async () => {
    const s = await seed();
    await setVoiceBalance(s, 600, 465);
    const t0 = nowMs;
    const started = await start(s);
    expect(started.runtime.metering?.granted).toBe(135);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(135);
    const append = vi.spyOn(started.channel, "appendInstructions");
    started.channel.simulateInputTranscript("hi");

    nowMs = t0 + 80_000;
    await tickVoiceMeter(started.runtime);
    expect(started.runtime.metering?.exhausted).toBe(true);
    expect(append).not.toHaveBeenCalled();

    nowMs = t0 + 110_000;
    await tickVoiceMeter(started.runtime);
    nowMs = t0 + 120_000;
    await tickVoiceMeter(started.runtime);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(VOICE_LIMIT_WARNING_INSTRUCTIONS, null);
    expect(started.runtime.turns).toHaveLength(0);

    started.channel.setUsageSeconds(135);
    nowMs = t0 + 135_000;
    await tickVoiceMeter(started.runtime);
    const result = await started.runtime.terminating;
    expect(result?.endReason).toBe("usage_limit");
    expect(getVoiceRuntime(started.sessionId)).toBeUndefined();

    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({ meteringStatus: "settled", voiceSeconds: 135, errorCode: "usage_limit" });
    const balance = await balanceOf(s);
    expect(balance.voiceSecondsConsumed).toBe(600);
    expect(balance.voiceSecondsReserved).toBe(0);
  });

  it("enforcement still closes when the warning cannot be delivered", async () => {
    const s = await seed();
    await setVoiceBalance(s, 600, 500);
    const t0 = nowMs;
    const started = await start(s);
    vi.spyOn(started.channel, "appendInstructions").mockRejectedValue(new Error("sideband busy"));
    started.channel.simulateInputTranscript("hi");
    for (const t of [50, 75, 100]) {
      nowMs = t0 + t * 1000;
      await tickVoiceMeter(started.runtime);
    }
    const result = await started.runtime.terminating;
    expect(result?.endReason).toBe("usage_limit");
  });

  it("a later extension can itself be partial", async () => {
    const s = await seed();
    await setVoiceBalance(s, 450);
    const t0 = nowMs;
    const started = await start(s);
    expect(started.runtime.metering?.granted).toBe(300);

    nowMs = t0 + 240_000;
    await tickVoiceMeter(started.runtime);
    expect(started.runtime.metering?.granted).toBe(450);
    expect((await sessionRow(started.sessionId))?.voiceSecondsGranted).toBe(450);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(450);

    nowMs = t0 + 390_000;
    await tickVoiceMeter(started.runtime);
    expect(started.runtime.metering?.exhausted).toBe(true);
    expect(started.runtime.terminating).toBeNull();
  });

  it("unlimited entitlements always grant full blocks", async () => {
    const s = await seed();
    await setVoiceBalance(s, null, 999_999);
    const t0 = nowMs;
    const started = await start(s);
    expect(started.runtime.metering?.granted).toBe(300);
    nowMs = t0 + 250_000;
    await tickVoiceMeter(started.runtime);
    expect(started.runtime.metering?.granted).toBe(600);
  });

  it("concurrent admissions never over-reserve the remaining minutes", async () => {
    const s = await seed();
    await setVoiceBalance(s, 400);
    const [a, b] = await Promise.all([admit(s), admit(s, "widget", "visitor02")]);
    expect(a.result.ok && b.result.ok).toBe(true);
    const grants = [a, b].map((x) => (x.result.ok ? x.result.admission.granted : 0)).sort((x, y) => x - y);
    expect(grants).toEqual([100, 300]);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(400);

    const c = await admit(s, "widget", "visitor03");
    expect(c.result).toEqual({ ok: false, status: 402, reason: "voice_minutes_exhausted" });
  });

  it("less than 30 s remaining refuses with 402 and creates no row", async () => {
    const s = await seed();
    await setVoiceBalance(s, 600, 580);
    const { sessionId, result } = await admit(s);
    expect(result).toEqual({ ok: false, status: 402, reason: "voice_minutes_exhausted" });
    expect(await sessionRow(sessionId)).toBeUndefined();
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
  });

  it("a mint that fails before provider create returns its grant", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const { sessionId, result } = await admit(s);
    expect(result.ok).toBe(true);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(300);
    await releaseVoiceAdmission(sessionId);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
    expect(await sessionRow(sessionId)).toBeUndefined();
  });
});

describe("concurrency", () => {
  it("account concurrency cap refuses with 429 (free plan: 1)", async () => {
    const s = await seed({ plan: "free" });
    await setVoiceBalance(s, 600);
    await start(s);
    const { result } = await admit(s, "widget", "visitor02");
    expect(result).toEqual({ ok: false, status: 429, reason: "voice_concurrency_limit" });
  });

  it("instance cap applies in every mode", async () => {
    state.env.HOSTED_USAGE_ENFORCEMENT = "shadow";
    state.env.VOICE_MAX_CONCURRENT_SESSIONS = 1;
    const a = await seed();
    const b = await seed();
    const { sessionId } = await admit(a);
    const { result } = await admit(b);
    expect(result).toEqual({ ok: false, status: 429, reason: "voice_concurrency_limit" });
    await releaseVoiceAdmission(sessionId);
  });

  it("a new widget mint supersedes the same visitor's session and settles it", async () => {
    const s = await seed({ plan: "free" });
    await setVoiceBalance(s, 600);
    const first = await start(s);
    talk(first, 40);
    await supersedeVisitorVoiceSessions({ assistantId: s.assistantId, visitorId: "visitor01", source: "widget" });
    const result = await first.runtime.terminating;
    expect(result?.endReason).toBe("superseded");
    expect((await sessionRow(first.sessionId))?.meteringStatus).toBe("settled");
    const { result: second } = await admit(s);
    expect(second.ok).toBe(true);
  });
});

describe("Playground", () => {
  it("is measured but quota-exempt by default, and still counts toward concurrency", async () => {
    const s = await seed({ plan: "free" });
    await setVoiceBalance(s, 600, 590);
    const started = await start(s, { source: "playground" });
    expect(started.runtime.metering).toMatchObject({ quotaExempt: true, enforced: false, granted: 0 });
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);

    const { result } = await admit(s, "widget", "visitor02");
    expect(result).toEqual({ ok: false, status: 429, reason: "voice_concurrency_limit" });

    talk(started, 90);
    await endByClient(started);
    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({ voiceSeconds: 90, quotaExempt: true, meteringStatus: "settled" });
    expect((await balanceOf(s)).voiceSecondsConsumed).toBe(590);
    const [event] = await ledgerFor(started.sessionId);
    expect(event?.metadata).toMatchObject({ quotaExempt: true, source: "playground", voiceSeconds: 90 });
    expect(event?.finalCostMicros).toBe(75_000);
  });

  it("is enforced like any other source when the exemption flag is off", async () => {
    state.env.VOICE_QUOTA_EXEMPT_PLAYGROUND = false;
    const s = await seed();
    await setVoiceBalance(s, 600, 590);
    const { result } = await admit(s, "playground");
    expect(result).toEqual({ ok: false, status: 402, reason: "voice_minutes_exhausted" });
  });
});

describe("enforcement modes", () => {
  it("shadow: never refuses, balances untouched, shadow ledger row", async () => {
    state.env.HOSTED_USAGE_ENFORCEMENT = "shadow";
    const s = await seed({ plan: "free" });
    await setVoiceBalance(s, 0);
    const started = await start(s);
    const second = await start(s, { visitorId: "visitor02" });
    talk(started, 60);
    await endByClient(started);
    await endByClient(second);
    const balance = await balanceOf(s);
    expect(balance.voiceSecondsConsumed).toBe(0);
    expect(balance.voiceSecondsReserved).toBe(0);
    const [event] = await ledgerFor(started.sessionId);
    expect(event?.status).toBe("shadow");
    expect((await sessionRow(started.sessionId))?.voiceSeconds).toBe(60);
  });

  it("off: no ledger, no quota, but session seconds are still recorded", async () => {
    state.env.HOSTED_USAGE_ENFORCEMENT = "off";
    const s = await seed();
    const started = await start(s);
    talk(started, 45);
    await endByClient(started);
    expect(await ledgerFor(started.sessionId)).toHaveLength(0);
    expect(await sessionRow(started.sessionId)).toMatchObject({ voiceSeconds: 45, meteringMode: "off" });
  });

  it("settlement follows the mode captured at admission", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    state.env.HOSTED_USAGE_ENFORCEMENT = "off";
    talk(started, 30);
    await endByClient(started);
    expect((await balanceOf(s)).voiceSecondsConsumed).toBe(30);
    expect(await ledgerFor(started.sessionId)).toHaveLength(1);
  });
});

describe("measurement edge cases", () => {
  it("never-connected: 0 Voice seconds, provider init cost still recorded", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    started.channel.setUsageSeconds(8);
    await endByClient(started);
    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({ meteringStatus: "not_billable", voiceSeconds: 0 });
    const [event] = await ledgerFor(started.sessionId);
    expect(event).toMatchObject({ units: 15, finalCostMicros: 12_500 });
    expect((await balanceOf(s)).voiceSecondsConsumed).toBe(0);
  });

  it("wall clock caps implausible provider usage and flags the anomaly", async () => {
    const s = await seed();
    const started = await start(s, { startedAgoMs: 20_000 });
    talk(started, 300);
    await endByClient(started);
    const row = await sessionRow(started.sessionId);
    expect(row?.voiceSeconds).toBeGreaterThanOrEqual(35);
    expect(row?.voiceSeconds).toBeLessThanOrEqual(40);
    const [event] = await ledgerFor(started.sessionId);
    expect(event?.units).toBe(300);
    expect(event?.metadata).toMatchObject({ anomaly: "wallclock_cap" });
  });

  it("a provider pricing change changes cost only, never customer seconds", async () => {
    const s = await seed();
    const rate = (price: number): ModelPricingRow[] => [
      {
        id: `p_${price}`,
        provider: "openai",
        model: "gpt-live-1",
        operation: "voice_realtime",
        priceMicrosPerUnit: price,
        unit: "per_minute",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: null,
      },
    ];
    const a = await start(s);
    const b = await start(s, { visitorId: "visitor02" });
    for (const x of [a, b]) {
      x.channel.simulateInputTranscript("hi");
      await flush();
    }
    const ra = await settleVoiceUsage({ sessionId: a.sessionId, measurement: "provider_final", providerSeconds: 120, connected: true, catalog: rate(50_000) });
    const rb = await settleVoiceUsage({ sessionId: b.sessionId, measurement: "provider_final", providerSeconds: 120, connected: true, catalog: rate(100_000) });
    expect(ra?.voiceSeconds).toBe(120);
    expect(rb?.voiceSeconds).toBe(120);
    expect(ra?.providerCostMicros).toBe(100_000);
    expect(rb?.providerCostMicros).toBe(200_000);
  });
});

describe("crash / orphan recovery", () => {
  // Mock provider session ids repeat across instances; earlier tests' open rows must
  // not re-attach to this test's provider sessions.
  beforeEach(async () => {
    await db
      .update(voiceSessions)
      .set({ meteringStatus: "not_billable" })
      .where(eq(voiceSessions.meteringStatus, "open"));
  });

  it("re-attaches to the orphaned provider session and settles provider-final", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const started = await start(s);
    talk(started, 75);
    await flush();
    await crash(started);
    started.channel.setUsageSeconds(95);

    const outcomes = await recoverOrphanedVoiceSessions({ providerFactory: async () => started.provider });
    expect(outcomes.filter((o) => o.sessionId === started.sessionId)).toEqual([
      expect.objectContaining({ sessionId: started.sessionId, path: "provider_final" }),
    ]);
    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({
      meteringStatus: "settled",
      usageMeasurement: "provider_final",
      voiceSeconds: 95,
      status: "ended",
      errorCode: "runtime_lost",
    });
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
    expect((await balanceOf(s)).voiceSecondsConsumed).toBe(95);
    // Server-authoritative end: the orphan's provider session is hung up.
    expect(started.provider.hangups).toEqual([started.runtime.providerSessionId]);
  });

  it("an orphan whose sideband also dropped is re-attached, hung up, and settled provider-final", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 40);
    await flush();
    await crash(started);
    started.channel.simulateSidebandDrop();
    started.channel.setUsageSeconds(55);

    const outcome = await recoverOrphanedVoiceSession(
      { id: started.sessionId, providerSessionId: started.runtime.providerSessionId, usageCheckpointAt: new Date() },
      { trigger: "heartbeat", provider: started.provider },
    );
    expect(outcome.path).toBe("provider_final");
    expect(started.provider.hangups).toEqual([started.runtime.providerSessionId]);
    expect(await sessionRow(started.sessionId)).toMatchObject({ meteringStatus: "settled", voiceSeconds: 55 });
  });

  it("a provider session that already ended while detached settles from the checkpoint", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 30);
    await flush();
    await crash(started);
    started.channel.simulateSidebandDrop();
    started.channel.simulateProviderEndedWhileDetached();

    const outcomes = await recoverOrphanedVoiceSessions({ providerFactory: async () => started.provider });
    expect(outcomes.find((o) => o.sessionId === started.sessionId)?.path).toBe("checkpoint");
    expect(await sessionRow(started.sessionId)).toMatchObject({
      meteringStatus: "estimated",
      voiceSeconds: 30,
      errorCode: "runtime_lost",
    });
  });

  it("a sweep racing a heartbeat-triggered recovery settles once and hangs up once", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 20);
    await flush();
    await crash(started);
    const row = {
      id: started.sessionId,
      providerSessionId: started.runtime.providerSessionId,
      usageCheckpointAt: new Date(Date.now() - 5 * 60_000),
    };

    const [a, b] = await Promise.all([
      recoverOrphanedVoiceSession(row, { trigger: "heartbeat", provider: started.provider }),
      recoverOrphanedVoiceSession(row, { trigger: "sweep", provider: started.provider }),
    ]);
    expect([a.path, b.path].sort()).toEqual(["provider_final", "skipped"]);
    expect(started.provider.hangups).toHaveLength(1);
    expect(await ledgerFor(started.sessionId)).toHaveLength(1);
  });

  it("falls back to the durable checkpoint (estimated) when re-attach fails", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 90);
    await flush();
    await crash(started);

    await recoverOrphanedVoiceSessions({
      providerFactory: async () => new MockRealtimeVoiceProvider({ failAttachWith: "gone" }),
    });
    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({
      meteringStatus: "estimated",
      usageMeasurement: "provider_checkpoint",
      voiceSeconds: 90,
      status: "failed",
      errorCode: "runtime_lost",
    });
    const [event] = await ledgerFor(started.sessionId);
    expect(event?.metadata).toMatchObject({ meteringStatus: "estimated" });
  });

  it("a late terminate after the sweep settled is a no-op", async () => {
    const s = await seed();
    const started = await start(s);
    talk(started, 60);
    await flush();
    await crash(started);
    await recoverOrphanedVoiceSessions({ providerFactory: async () => null });
    await terminateVoiceSession(started.runtime, { reason: "remote_hangup", requestProviderClose: false });
    expect(await ledgerFor(started.sessionId)).toHaveLength(1);
    expect((await sessionRow(started.sessionId))?.meteringStatus).toBe("estimated");
  });

  it("ignores live sessions and fresh heartbeats", async () => {
    const s = await seed();
    const live = await start(s);
    const other = await start(s, { visitorId: "visitor02" });
    talk(other, 30);
    other.runtime.unsubscribe?.();
    clearVoiceRuntimeForTests();
    registerVoiceRuntime(live.runtime);
    await db
      .update(voiceSessions)
      .set({ usageCheckpointAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(voiceSessions.id, live.sessionId));
    const outcomes = await recoverOrphanedVoiceSessions({ providerFactory: async () => null });
    const ids = outcomes.map((o) => o.sessionId);
    expect(ids).not.toContain(live.sessionId);
    expect(ids).not.toContain(other.sessionId);
  });

  it("an admitted row whose provider session was never created settles not-billable", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const { sessionId } = await admit(s);
    await db
      .update(voiceSessions)
      .set({ usageCheckpointAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(voiceSessions.id, sessionId));
    const outcomes = await recoverOrphanedVoiceSessions({ providerFactory: async () => null });
    expect(outcomes.filter((o) => o.sessionId === sessionId)).toEqual([
      expect.objectContaining({ sessionId, path: "never_created" }),
    ]);
    expect(await sessionRow(sessionId)).toMatchObject({ meteringStatus: "not_billable", voiceSeconds: 0 });
    expect(await ledgerFor(sessionId)).toHaveLength(0);
    expect((await balanceOf(s)).voiceSecondsReserved).toBe(0);
  });

  it("legacy rows are never swept or billed", async () => {
    const s = await seed();
    const id = createId();
    await db.insert(voiceSessions).values({
      id,
      assistantId: s.assistantId,
      source: "widget",
      provider: "gpt-live",
      status: "connected",
      model: "gpt-live-1",
      voiceId: "marin",
      startedAt: new Date(Date.now() - 5 * HOUR_MS),
      interruptCount: 0,
      meteringStatus: "legacy",
    });
    const outcomes = await recoverOrphanedVoiceSessions({ providerFactory: async () => null });
    expect(outcomes.map((o) => o.sessionId)).not.toContain(id);
    expect(await settleVoiceUsage({ sessionId: id, measurement: "provider_final", providerSeconds: 60 })).toBeNull();
  });

  it("assistant deletion settles live and orphaned sessions; ledger rows survive", async () => {
    const s = await seed();
    await setVoiceBalance(s, 3600);
    const live = await start(s);
    talk(live, 40);
    const orphan = await start(s, { visitorId: "visitor02" });
    talk(orphan, 20);
    await flush();
    orphan.runtime.unsubscribe?.();
    clearVoiceRuntimeForTests();
    registerVoiceRuntime(live.runtime);

    await endVoiceSessionsForAssistant(s.assistantId);
    const balance = await balanceOf(s);
    expect(balance.voiceSecondsReserved).toBe(0);
    expect(balance.voiceSecondsConsumed).toBe(60);

    await db.delete(assistants).where(eq(assistants.id, s.assistantId));
    const events = await db.select().from(usageEvents).where(eq(usageEvents.accountId, s.accountId));
    const voice = events.filter((e) => e.operation === "voice_realtime");
    expect(voice).toHaveLength(2);
    expect(voice.every((e) => e.assistantId === null)).toBe(true);
  });
});

describe("privacy and recording independence", () => {
  it("no-store keeps only operational metering (no conversation, transcript or raw visitor id)", async () => {
    const s = await seed({ privacy: { storeConversations: false } });
    const started = await start(s);
    started.channel.simulateInputTranscript("my card number is 4417-9921");
    started.channel.setUsageSeconds(50);
    await endByClient(started);

    const row = await sessionRow(started.sessionId);
    expect(row).toMatchObject({ ephemeral: true, conversationId: null, voiceSeconds: 50 });
    const [event] = await ledgerFor(started.sessionId);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("4417-9921");
    expect(serialized).not.toContain("visitor01");
    expect(Object.keys(event?.metadata ?? {}).sort()).toEqual(
      ["measurement", "meteringStatus", "periodStart", "providerUnit", "source", "voiceSeconds"].sort(),
    );
    const everything = await db.execute(sql`select * from voice_sessions where id = ${started.sessionId}`);
    expect(JSON.stringify(everything)).not.toContain("4417-9921");
  });

  it("recording on or off meters identically", async () => {
    setObjectStorageForTests(createMemoryObjectStorage());
    const s = await seed({ voice: { enabled: true, saveTranscripts: true, saveAudioRecordings: true } });
    const recorded = await start(s, { record: true });
    const plain = await start(s, { visitorId: "visitor02" });
    for (const x of [recorded, plain]) talk(x, 70);
    await endByClient(recorded);
    await endByClient(plain);

    const [a, b] = await Promise.all([sessionRow(recorded.sessionId), sessionRow(plain.sessionId)]);
    expect(a?.voiceSeconds).toBe(70);
    expect(b?.voiceSeconds).toBe(70);
    const [ea] = await ledgerFor(recorded.sessionId);
    const [eb] = await ledgerFor(plain.sessionId);
    expect(ea?.finalCostMicros).toBe(eb?.finalCostMicros);
    const recordings = await db
      .select()
      .from(voiceRecordings)
      .where(eq(voiceRecordings.sessionId, recorded.sessionId));
    expect(recordings).toHaveLength(1);
  });
});

describe("reports", () => {
  /** postgres-js returns row arrays from execute(); PGlite returns { rows }. */
  function withArrayExecute(fn: () => Promise<void>) {
    return async () => {
      const real = state.db as Database;
      state.db = new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === "execute") {
            return async (query: unknown) =>
              (await (target.execute as unknown as (q: unknown) => Promise<{ rows: unknown[] }>)(query)).rows;
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      try {
        await fn();
      } finally {
        state.db = real;
      }
    };
  }

  it("owner minutes: counted vs Playground, estimated, by source and assistant", async () => {
    const s = await seed();
    await setVoiceBalance(s, 1200);
    const widget = await start(s);
    talk(widget, 125);
    await endByClient(widget);
    const playground = await start(s, { source: "playground" });
    talk(playground, 60);
    await endByClient(playground);
    const crashed = await start(s, { visitorId: "visitor09" });
    talk(crashed, 30);
    await flush();
    await crash(crashed);
    await recoverOrphanedVoiceSessions({ providerFactory: async () => null });
    const live = await start(s, { visitorId: "visitor10" });

    const report = await getVoiceUsageReport(s.account);
    expect(report).toMatchObject({
      mode: "enforce",
      countedSeconds: 155,
      limitSeconds: 1200,
      reservedSeconds: 300,
      totalSeconds: 215,
      playgroundSeconds: 60,
      playgroundExempt: true,
      estimatedSeconds: 30,
      sessionCount: 3,
      inProgressSessions: 1,
    });
    expect(report.bySource).toEqual(
      expect.arrayContaining([
        { source: "widget", seconds: 155, sessions: 2, quotaExempt: false },
        { source: "playground", seconds: 60, sessions: 1, quotaExempt: true },
      ]),
    );
    expect(report.byAssistant).toEqual([
      { assistantId: s.assistantId, assistantName: "Voice Bot", seconds: 215, sessions: 3 },
    ]);
    expect(await getAssistantVoiceSeconds(s.account, s.assistantId)).toEqual({
      seconds: 215,
      playgroundSeconds: 60,
      sessions: 3,
    });
    await endByClient(live);
  });

  it("legacy and not-billable rows never count", async () => {
    const s = await seed();
    const neverConnected = await start(s);
    await endByClient(neverConnected);
    await db.insert(voiceSessions).values({
      id: createId(),
      assistantId: s.assistantId,
      source: "widget",
      provider: "gpt-live",
      status: "ended",
      model: "gpt-live-1",
      voiceId: "marin",
      startedAt: new Date(),
      interruptCount: 0,
      meteringStatus: "legacy",
      hostingAccountId: s.accountId,
      voiceSeconds: 999,
    });
    const report = await getVoiceUsageReport(s.account);
    expect(report.totalSeconds).toBe(0);
    expect(report.sessionCount).toBe(0);
  });

  it(
    "customer cost reports exclude Voice provider cost; REST summary carries minutes only",
    withArrayExecute(async () => {
      const s = await seed();
      await setVoiceBalance(s, 600);
      const started = await start(s);
      talk(started, 252);
      await endByClient(started);

      const summary = await getUsageSummary(s.account);
      expect(summary.voice).toEqual({
        voiceSecondsUsed: 252,
        voiceSecondsLimit: 600,
        voiceSecondsReserved: 0,
        playgroundVoiceSeconds: 0,
      });
      expect(summary.consumedMicros).toBe(0);

      expect(await getUsageByAssistant(s.account)).toEqual([]);
      expect(await getUsageByModel(s.account)).toEqual([]);

      const { events } = await getRecentUsageEvents(s.account);
      const voice = events.find((e) => e.operation === "voice_realtime");
      expect(voice?.finalCostMicros).toBe(0);
      expect(voice?.metadata.voiceSeconds).toBe(252);
      expect(formatVoiceDuration(Number(voice?.metadata.voiceSeconds))).toBe("4m 12s");
    }),
  );

  it(
    "operator view shows Voice seconds, provider seconds and provider cost",
    withArrayExecute(async () => {
      const s = await seed();
      await setVoiceBalance(s, 600);
      const started = await start(s);
      talk(started, 120);
      await endByClient(started);
      const rows = await listAdminHostingAccounts({ limit: 200 });
      const row = rows.find((r) => r.id === s.accountId);
      expect(row).toMatchObject({
        periodVoiceSeconds: 120,
        periodVoiceSecondsConsumed: 120,
        periodVoiceSecondsLimit: 600,
        periodVoiceProviderSeconds: 120,
        periodVoiceProviderCostMicros: 100_000,
      });
    }),
  );
});

describe("formatVoiceDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatVoiceDuration(45)).toBe("45s");
    expect(formatVoiceDuration(252)).toBe("4m 12s");
    expect(formatVoiceDuration(120)).toBe("2m");
    expect(formatVoiceDuration(3780)).toBe("1h 3m");
  });
});
