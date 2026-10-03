import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assistants,
  eq,
  hostingAccounts,
  resolveEffectiveVoicePersistence,
  usageEvents,
  user,
  voiceSessions,
  type Database,
} from "@chatai/database";
import { createTestDatabase } from "@chatai/database/testing";
import type { VoiceControlEvent } from "@chatai/voice";
import { MockRealtimeVoiceProvider, type MockControlChannel } from "@chatai/voice/mock";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  provider: null as unknown,
  env: {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    VOICE_PROVIDER: "mock",
    VOICE_RECORDING_SPOOL_DIR: "",
    HOSTED_USAGE_ENFORCEMENT: "enforce" as const,
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000,
    HOSTED_USAGE_RECONCILE_STALE_MINUTES: 15,
    VOICE_QUOTA_EXEMPT_PLAYGROUND: true,
    VOICE_MAX_CONCURRENT_SESSIONS: undefined as number | undefined,
  },
}));

vi.mock("@/lib/db", () => ({ db: () => state.db }));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/env", () => ({ env: state.env }));
vi.mock("@/lib/cors", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  jsonWithCors: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    Response.json(body, { status: init?.status ?? 200, headers: init?.headers }),
}));
// The restarted process reaches the same provider session through a fresh client.
vi.mock("@/lib/voice/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voice/credentials")>()),
  createVoiceProvider: () => state.provider,
}));

import { POST as endPOST } from "@/app/api/v1/voice/sessions/[sessionId]/end/route";
import { POST as heartbeatPOST } from "@/app/api/v1/voice/sessions/[sessionId]/heartbeat/route";
import { createId } from "@/lib/ids";

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { createVoiceControlToken } from "./control-token";
import { createVoiceMeter, setVoiceMeterAutoTickForTests } from "./enforcement";
import { clearEndedVoiceSessionsForTests } from "./lifecycle";
import { markVoiceProviderCreated } from "./metering";
import { insertDurableVoiceSessionRow } from "./persist";
import { admitVoiceSession } from "./quota";
import { formatVoiceRuntimeInstanceId, voiceRuntimeInstanceId, voiceRuntimeOwner } from "./runtime-instance";
import { clearVoiceRuntimeForTests, registerVoiceRuntime, type VoiceRuntimeSession } from "./session-runtime";
import { superviseSideband } from "./sideband-supervisor";

let db: Database;
let close: () => Promise<void>;
let seq = 0;

const HOST_KEY = voiceRuntimeInstanceId().split("_")[1]!;
const GONE_PID = 1_999_999_999;

async function seed() {
  seq += 1;
  const userId = `user_rr_${seq}`;
  const accountId = `acct_rr_${seq}`;
  const assistantId = `asst_rr_${seq}`;
  await db.insert(user).values({ id: userId, name: "Owner", email: `rr${seq}@example.com` });
  await db.insert(hostingAccounts).values({
    id: accountId,
    userId,
    planCode: "pro",
    periodAnchor: new Date("2026-01-01T00:00:00Z"),
  });
  await db.insert(assistants).values({
    id: assistantId,
    publicId: `pub_rr_${seq}`,
    userId,
    name: "Voice Bot",
    privacySettings: { storeConversations: true },
    voiceSettings: { enabled: true, saveTranscripts: true },
  });
  const [account] = await db.select().from(hostingAccounts).where(eq(hostingAccounts.id, accountId));
  return { assistantId, account: account! };
}

type Call = {
  sessionId: string;
  token: string;
  runtime: VoiceRuntimeSession;
  channel: MockControlChannel;
  provider: MockRealtimeVoiceProvider;
  /** What the visitor's WebRTC data channel sees from the provider session. */
  browserPeer: VoiceControlEvent[];
};

/** A live widget call on the "old" process: admitted, provider created, sideband attached. */
async function liveCall(): Promise<Call> {
  const s = await seed();
  const sessionId = createId();
  const persistence = resolveEffectiveVoicePersistence({ storeConversations: true }, { enabled: true });
  const admitted = await admitVoiceSession({
    sessionId,
    assistantId: s.assistantId,
    account: s.account,
    source: "widget",
    visitorId: "visitor01",
    ephemeral: persistence.ephemeral,
    providerId: "gpt-live",
    model: "gpt-live-1",
    voiceId: "marin",
  });
  if (!admitted.ok) throw new Error(admitted.reason);
  const provider = new MockRealtimeVoiceProvider();
  state.provider = provider;
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: { model: "gpt-live-1", voice: "marin", delegationMode: "client" } as Parameters<
      typeof provider.createWebRtcSession
    >[0]["sessionConfig"],
  });
  const startedAt = new Date(Date.now() - 60_000);
  await markVoiceProviderCreated({ sessionId, providerSessionId: created.providerSessionId, startedAt });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  const runtime = fakeVoiceRuntime({
    sessionId,
    providerSessionId: created.providerSessionId,
    assistantId: s.assistantId,
    source: "widget",
    visitorId: "visitor01",
    ephemeral: false,
    persistence,
    conversationId: null,
    channel,
    provider,
    providerId: "gpt-live",
    status: "connecting",
    startedAt,
    metering: createVoiceMeter(admitted.admission),
    endReason: null,
  });
  runtime.assistant!.hostingAccount = s.account;
  superviseSideband(runtime, channel);
  await insertDurableVoiceSessionRow(runtime);
  registerVoiceRuntime(runtime);

  const browserPeer: VoiceControlEvent[] = [];
  channel.subscribe((event) => browserPeer.push(event));

  channel.simulateInputTranscript("hello");
  channel.setUsageSeconds(12);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const token = createVoiceControlToken({ sessionId, visitorId: "visitor01" })!;
  return { sessionId, token, runtime, channel, provider, browserPeer };
}

/**
 * SIGKILL of the owning process: its runtime and sideband listener vanish, the row
 * stays open with a fresh checkpoint and names the dead process as owner.
 */
async function killOwner(call: Call, ownerInstanceId: string) {
  call.runtime.unsubscribe?.();
  call.runtime.unsubscribe = null;
  clearVoiceRuntimeForTests();
  clearEndedVoiceSessionsForTests();
  await db
    .update(voiceSessions)
    .set({ runtimeInstanceId: ownerInstanceId, usageCheckpointAt: new Date(Date.now() - 5_000) })
    .where(eq(voiceSessions.id, call.sessionId));
}

async function beat(call: Call) {
  // Heartbeats in these tests are seconds apart; skip the per-second cap.
  delete (globalThis as Record<string, unknown>).__chatai_voice_last_heartbeat__;
  const response = await heartbeatPOST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${call.sessionId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: call.token }),
    }),
    { params: Promise.resolve({ sessionId: call.sessionId }) },
  );
  return { status: response.status, body: (await response.json()) as { state?: string; endReason?: string } };
}

async function end(call: Call) {
  const response = await endPOST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${call.sessionId}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitorId: "visitor01", reason: "close_requested" }),
    }),
    { params: Promise.resolve({ sessionId: call.sessionId }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function row(sessionId: string) {
  const [found] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, sessionId));
  return found!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
  state.env.VOICE_RECORDING_SPOOL_DIR = mkdtempSync(path.join(tmpdir(), "chatai-restart-spool-"));
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  setVoiceMeterAutoTickForTests(false);
  clearVoiceRuntimeForTests();
  clearEndedVoiceSessionsForTests();
  // Mock provider session ids repeat per provider instance: park earlier open rows.
  await db.update(voiceSessions).set({ meteringStatus: "not_billable" }).where(eq(voiceSessions.meteringStatus, "open"));
});

afterEach(() => {
  setVoiceMeterAutoTickForTests(true);
});

describe("server restart: heartbeat-triggered orphan recovery", () => {
  it("old process gone → heartbeat on the new process recovers, hangs up, settles once, never healthy", async () => {
    const call = await liveCall();
    await killOwner(call, formatVoiceRuntimeInstanceId({ hostKey: HOST_KEY, pid: GONE_PID, bootId: "0f0e-dead" }));

    const first = await beat(call);
    expect(first).toEqual({ status: 200, body: { state: "lost", nextHeartbeatMs: 5_000 } });

    await vi.waitFor(async () => expect((await row(call.sessionId)).meteringStatus).not.toBe("open"));
    // Server-authoritative end: re-attached sideband → HTTP hangup → session.closed.
    expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect(call.browserPeer.some((event) => event.type === "session.closed")).toBe(true);
    expect(await row(call.sessionId)).toMatchObject({
      status: "ended",
      errorCode: "runtime_lost",
      meteringStatus: "settled",
      usageMeasurement: "provider_final",
      voiceSeconds: 12,
    });
    const ledger = await db.select().from(usageEvents).where(eq(usageEvents.requestId, call.sessionId));
    expect(ledger).toHaveLength(1);

    const later = [await beat(call), await beat(call)];
    expect(later.map((answer) => answer.body.state)).toEqual(["ended", "ended"]);
    expect([first, ...later].some((answer) => answer.body.state === "healthy")).toBe(false);
    // A second recovery trigger is a no-op: still one hangup, one ledger row.
    expect(call.provider.hangups).toHaveLength(1);
    expect(await db.select().from(usageEvents).where(eq(usageEvents.requestId, call.sessionId))).toHaveLength(1);
  });

  it("an owner on another host is still treated as possibly alive (421), nothing recovered", async () => {
    const call = await liveCall();
    await killOwner(call, formatVoiceRuntimeInstanceId({ hostKey: "000000000000", pid: 42, bootId: "0f0e" }));
    const answer = await beat(call);
    expect(answer.status).toBe(421);
    expect(call.provider.hangups).toEqual([]);
    expect((await row(call.sessionId)).meteringStatus).toBe("open");
  });

  it("a same-host owner whose process is still running is not declared dead", async () => {
    const call = await liveCall();
    await killOwner(call, formatVoiceRuntimeInstanceId({ hostKey: HOST_KEY, pid: process.ppid, bootId: "0f0e" }));
    expect((await beat(call)).status).toBe(421);
    expect(call.provider.hangups).toEqual([]);
  });
});

describe("/end routed to a process that does not own the call", () => {
  it("a possibly-live foreign owner answers 421, touches nothing", async () => {
    const call = await liveCall();
    await killOwner(call, formatVoiceRuntimeInstanceId({ hostKey: "000000000000", pid: 42, bootId: "0f0e" }));
    const answer = await end(call);
    expect(answer).toEqual({ status: 421, body: { error: "Voice session is handled elsewhere.", reason: "misrouted" } });
    expect(call.provider.hangups).toEqual([]);
    expect((await row(call.sessionId)).meteringStatus).toBe("open");
  });

  it("a dead same-host owner or a finished row is simply not found (404)", async () => {
    const call = await liveCall();
    await killOwner(call, formatVoiceRuntimeInstanceId({ hostKey: HOST_KEY, pid: GONE_PID, bootId: "0f0e-dead" }));
    expect((await end(call)).status).toBe(404);

    await db.update(voiceSessions).set({ meteringStatus: "settled" }).where(eq(voiceSessions.id, call.sessionId));
    expect((await end(call)).status).toBe(404);
  });
});

describe("voiceRuntimeOwner", () => {
  const self = formatVoiceRuntimeInstanceId({ hostKey: "aaaaaaaaaaaa", pid: 100, bootId: "be-0" });
  const deps = { self, hostKey: "aaaaaaaaaaaa", pid: 100, isPidAlive: (pid: number) => pid === 200 };

  it("recognizes this process, a dead same-host predecessor and unknowable owners", () => {
    expect(voiceRuntimeOwner(self, deps)).toBe("self");
    // Restart that reused this pid (containers) or whose pid is gone.
    expect(voiceRuntimeOwner(formatVoiceRuntimeInstanceId({ hostKey: "aaaaaaaaaaaa", pid: 100, bootId: "be-1" }), deps)).toBe("dead");
    expect(voiceRuntimeOwner(formatVoiceRuntimeInstanceId({ hostKey: "aaaaaaaaaaaa", pid: 300, bootId: "be-2" }), deps)).toBe("dead");
    expect(voiceRuntimeOwner(formatVoiceRuntimeInstanceId({ hostKey: "aaaaaaaaaaaa", pid: 200, bootId: "be-2" }), deps)).toBe("unknown");
    expect(voiceRuntimeOwner(formatVoiceRuntimeInstanceId({ hostKey: "bbbbbbbbbbbb", pid: 300, bootId: "be-2" }), deps)).toBe("unknown");
    // Ids minted before this format: never declared dead.
    expect(voiceRuntimeOwner("rt_2b7c0e9e-1f5e-4a44-9d5e-2b1f0a4f9c11", deps)).toBe("unknown");
  });
});
