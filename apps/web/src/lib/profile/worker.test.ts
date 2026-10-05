import { assistantProfileJobs, assistantProfiles, assistants, eq, sql, user, type Database } from "@chatai/database";
import { createTestDatabase } from "@chatai/database/testing";
import type { generateKeyFactCandidates } from "@chatai/rag/answer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({
  begin: vi.fn(async () => ({ id: "reservation" })),
  finish: vi.fn(async () => undefined),
  abort: vi.fn(async () => undefined),
}));

vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: "postgres://unused" } }));
vi.mock("@/lib/ai-config", () => ({
  resolveAssistantModels: async () => ({ chat: {}, embedding: {}, billing: {} }),
}));
vi.mock("@/lib/hosting/accounts", () => ({
  resolveBillableAccountForAssistant: async () => ({ id: "acct_1" }),
  checkHostingAccountAccess: () => ({ ok: true }),
}));
vi.mock("@/lib/hosting/usage-gate", () => ({
  beginProfileUsageReservation: gate.begin,
  finishProfileUsageReservation: gate.finish,
  abortEvalUsageReservation: gate.abort,
}));
vi.mock("@/lib/audit/log-audit-event", () => ({ logAuditEvent: async () => undefined }));

import {
  claimProfileJob,
  enqueueProfileFactsJob,
  PROFILE_JOB_MAX_ATTEMPTS,
  settleProfileJob,
} from "./jobs";
import { processProfileJobOnce, setProfileWorkerDepsForTests } from "./worker";

type FactResult = Awaited<ReturnType<typeof generateKeyFactCandidates>>;

const generated: FactResult = {
  facts: [],
  conflicts: [],
  rejected: 0,
  usages: [
    {
      kind: "chat_completion",
      provider: "openai",
      model: "m",
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, totalTokens: 15 },
      step: "profile_facts",
    },
  ],
};

let db: Database;
let close: () => Promise<void>;
let seq = 0;
let assistantId: string;
const generate = vi.fn<typeof generateKeyFactCandidates>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function job() {
  const [row] = await db.select().from(assistantProfileJobs).where(eq(assistantProfileJobs.assistantId, assistantId));
  return row!;
}

async function profile() {
  const [row] = await db.select().from(assistantProfiles).where(eq(assistantProfiles.assistantId, assistantId));
  return row!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  seq += 1;
  assistantId = `a_${seq}`;
  await db.insert(user).values({ id: `u_${seq}`, name: "Owner", email: `owner${seq}@example.com` });
  await db.insert(assistants).values({ id: assistantId, publicId: `pub_${seq}`, userId: `u_${seq}`, name: "Bot" });
  generate.mockReset().mockResolvedValue(generated);
  gate.begin.mockClear();
  gate.finish.mockClear();
  gate.abort.mockClear();
  setProfileWorkerDepsForTests({ generateKeyFactCandidates: generate });
});

afterEach(async () => {
  setProfileWorkerDepsForTests(null);
  // Jobs from earlier tests must not be claimed by later ones.
  await db.delete(assistantProfileJobs);
});

describe("profile worker", () => {
  it("completes a job, publishes suggestions and bills once", async () => {
    await enqueueProfileFactsJob(db, assistantId, "owner");
    expect(await processProfileJobOnce(db)).toBe(true);

    expect(await job()).toMatchObject({ status: "completed", error: null, attempts: 1, lockedAt: null });
    expect(await profile()).toMatchObject({ refreshStatus: "idle", version: 2 });
    expect(gate.finish).toHaveBeenCalledTimes(1);
    expect(await processProfileJobOnce(db)).toBe(false);
  });

  it("a failed attempt is retried later with backoff, not immediately", async () => {
    generate.mockRejectedValueOnce(new Error("provider 500"));
    await enqueueProfileFactsJob(db, assistantId, "owner");
    await processProfileJobOnce(db);

    expect(await job()).toMatchObject({ status: "pending", error: "generation_failed", attempts: 1 });
    expect(await profile()).toMatchObject({ refreshStatus: "pending", lastError: "generation_failed" });
    const [due] = (await db
      .select({ later: sql<boolean>`${assistantProfileJobs.runAfter} > now() + interval '25 seconds'` })
      .from(assistantProfileJobs)
      .where(eq(assistantProfileJobs.assistantId, assistantId)));
    expect(due?.later).toBe(true);
    // Not due yet: nothing to claim.
    expect(await processProfileJobOnce(db)).toBe(false);
  });

  it("the last failed attempt marks the job and the profile failed", async () => {
    generate.mockRejectedValue(new Error("provider 500"));
    await enqueueProfileFactsJob(db, assistantId, "owner");
    await db.update(assistantProfileJobs).set({ attempts: PROFILE_JOB_MAX_ATTEMPTS - 1 });
    await processProfileJobOnce(db);

    expect(await job()).toMatchObject({ status: "failed", attempts: PROFILE_JOB_MAX_ATTEMPTS });
    expect(await profile()).toMatchObject({ refreshStatus: "failed", lastError: "generation_failed" });
  });

  it("a model call that never returns times out and is retried", async () => {
    setProfileWorkerDepsForTests({ generateKeyFactCandidates: () => new Promise(() => undefined), generationTimeoutMs: 20 });
    await enqueueProfileFactsJob(db, assistantId, "owner");
    await processProfileJobOnce(db);

    expect(await job()).toMatchObject({ status: "pending", error: "generation_timeout" });
    expect(gate.abort).toHaveBeenCalledTimes(1);
    expect(gate.finish).not.toHaveBeenCalled();
  });

  it("a crashed worker's exhausted job becomes failed instead of processing forever", async () => {
    await enqueueProfileFactsJob(db, assistantId, "owner");
    await db.insert(assistantProfiles).values({ assistantId, refreshStatus: "running" });
    await db.update(assistantProfileJobs).set({
      status: "processing",
      attempts: PROFILE_JOB_MAX_ATTEMPTS,
      lockedAt: sql`now() - interval '10 minutes'`,
    });

    expect(await processProfileJobOnce(db)).toBe(false);
    expect(await job()).toMatchObject({ status: "failed", error: "attempts_exhausted", lockedAt: null });
    expect(await profile()).toMatchObject({ refreshStatus: "failed", lastError: "attempts_exhausted" });
  });

  it("a stale reclaim never lets two workers finish or bill the same job", async () => {
    const slow = deferred<FactResult>();
    generate.mockImplementationOnce(() => slow.promise);
    await enqueueProfileFactsJob(db, assistantId, "owner");

    const workerA = processProfileJobOnce(db);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    // Worker A looks dead to the queue; worker B reclaims and finishes the job.
    await db.update(assistantProfileJobs).set({ lockedAt: sql`now() - interval '10 minutes'` });
    expect(await processProfileJobOnce(db)).toBe(true);
    expect(await job()).toMatchObject({ status: "completed", attempts: 2 });
    expect(gate.finish).toHaveBeenCalledTimes(1);
    const afterB = await profile();

    // Worker A's late result is neither billed nor published, and the job is untouched.
    slow.resolve(generated);
    await workerA;
    expect(gate.finish).toHaveBeenCalledTimes(1);
    expect(gate.abort).toHaveBeenCalledTimes(1);
    expect(await job()).toMatchObject({ status: "completed", attempts: 2 });
    expect((await profile()).version).toBe(afterB.version);
  });

  it("only one of two concurrent claims wins a job", async () => {
    await enqueueProfileFactsJob(db, assistantId, "owner");
    const claims = await Promise.all([claimProfileJob(db), claimProfileJob(db)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("settling with a stale claim writes nothing", async () => {
    await enqueueProfileFactsJob(db, assistantId, "owner");
    const stale = (await claimProfileJob(db))!;
    await db.update(assistantProfileJobs).set({ lockedAt: sql`now() - interval '10 minutes'` });
    const current = (await claimProfileJob(db))!;
    expect(current.attempts).toBe(stale.attempts + 1);

    expect(await settleProfileJob(db, stale, { status: "failed", error: "generation_failed" })).toBe(false);
    expect(await job()).toMatchObject({ status: "processing", error: null });
    expect(await settleProfileJob(db, current, { status: "completed", error: null })).toBe(true);
  });

  it("a retry yields to a newer pending job (one pending job per assistant)", async () => {
    await enqueueProfileFactsJob(db, assistantId, "owner");
    const claim = (await claimProfileJob(db))!;
    await enqueueProfileFactsJob(db, assistantId, "owner");

    expect(await settleProfileJob(db, claim, { status: "pending", error: "generation_failed" })).toBe(true);
    const rows = await db.select().from(assistantProfileJobs).where(eq(assistantProfileJobs.assistantId, assistantId));
    expect(rows.map((row) => [row.status, row.error]).sort()).toEqual([
      ["completed", "superseded"],
      ["pending", null],
    ]);
  });
});
