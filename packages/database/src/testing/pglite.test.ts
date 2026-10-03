import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestDatabase } from "./pglite";

type Rows<T> = { rows: T[] };

describe("migrations", () => {
  it("apply cleanly through 0015 (voice recording lifecycle)", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const columns = (await db.execute(
        sql`select column_name, is_nullable from information_schema.columns where table_name = 'voice_recordings'`,
      )) as unknown as { rows: Array<{ column_name: string; is_nullable: string }> };
      const byName = new Map(columns.rows.map((c) => [c.column_name, c.is_nullable]));
      for (const name of ["status", "duration_ms", "partial", "expires_at", "deleted_at", "error_code", "updated_at"]) {
        expect(byName.has(name)).toBe(true);
      }
      expect(byName.get("storage_key")).toBe("YES");
    } finally {
      await close();
    }
  }, 60_000);

  it("apply cleanly through 0016 (voice usage minutes)", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const sessionColumns = (await db.execute(
        sql`select column_name, column_default from information_schema.columns where table_name = 'voice_sessions'`,
      )) as unknown as Rows<{ column_name: string; column_default: string | null }>;
      const sessions = new Map(sessionColumns.rows.map((c) => [c.column_name, c.column_default]));
      for (const name of [
        "metering_status",
        "metering_mode",
        "hosting_account_id",
        "usage_period_start",
        "connected_at",
        "provider_usage_seconds",
        "usage_checkpoint_at",
        "voice_seconds",
        "voice_seconds_granted",
        "quota_exempt",
        "usage_measurement",
        "usage_settled_at",
      ]) {
        expect(sessions.has(name)).toBe(true);
      }
      // Existing rows were backfilled as legacy; new rows start open.
      expect(sessions.get("metering_status")).toContain("open");

      const balanceColumns = (await db.execute(
        sql`select column_name from information_schema.columns where table_name = 'usage_period_balances'`,
      )) as unknown as Rows<{ column_name: string }>;
      const balances = new Set(balanceColumns.rows.map((c) => c.column_name));
      for (const name of ["voice_seconds_limit", "voice_seconds_reserved", "voice_seconds_consumed"]) {
        expect(balances.has(name)).toBe(true);
      }

      const enums = (await db.execute(
        sql`select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname in ('usage_operation', 'model_pricing_operation', 'model_pricing_unit', 'voice_metering_status')`,
      )) as unknown as Rows<{ typname: string; enumlabel: string }>;
      const labels = enums.rows.map((r) => `${r.typname}:${r.enumlabel}`);
      expect(labels).toEqual(
        expect.arrayContaining([
          "usage_operation:voice_realtime",
          "model_pricing_operation:voice_realtime",
          "model_pricing_unit:per_minute",
          "voice_metering_status:legacy",
          "voice_metering_status:not_billable",
        ]),
      );

      const plans = (await db.execute(
        sql`select plan_code, features from plan_entitlements order by plan_code`,
      )) as unknown as Rows<{ plan_code: string; features: Record<string, unknown> }>;
      const free = plans.rows.find((p) => p.plan_code === "free");
      expect(free?.features).toMatchObject({ voiceMinutesMonthly: 10, maxConcurrentVoiceSessions: 1 });
    } finally {
      await close();
    }
  }, 60_000);

  it("apply cleanly through 0017 (message audio offset)", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const columns = (await db.execute(
        sql`select is_nullable, data_type, column_default from information_schema.columns
            where table_name = 'messages' and column_name = 'audio_offset_ms'`,
      )) as unknown as Rows<{ is_nullable: string; data_type: string; column_default: string | null }>;
      expect(columns.rows).toEqual([
        { is_nullable: "YES", data_type: "integer", column_default: null },
      ]);

      await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Owner', 'o@example.com')`);
      await db.execute(sql`insert into assistants (id, public_id, user_id, name) values ('a1', 'pub_a1', 'u1', 'A')`);
      await db.execute(sql`insert into conversations (id, assistant_id) values ('c1', 'a1')`);
      // Legacy-shaped insert (column omitted) stays NULL.
      await db.execute(sql`insert into messages (id, conversation_id, role, content) values ('m1', 'c1', 'user', 'hi')`);
      await db.execute(
        sql`insert into messages (id, conversation_id, role, content, audio_offset_ms) values ('m2', 'c1', 'user', 'hi', 1250)`,
      );
      const rows = (await db.execute(
        sql`select id, audio_offset_ms from messages order by id`,
      )) as unknown as Rows<{ id: string; audio_offset_ms: number | null }>;
      expect(rows.rows).toEqual([
        { id: "m1", audio_offset_ms: null },
        { id: "m2", audio_offset_ms: 1250 },
      ]);
      await expect(
        db.execute(
          sql`insert into messages (id, conversation_id, role, content, audio_offset_ms) values ('m3', 'c1', 'user', 'hi', -1)`,
        ),
      ).rejects.toThrow();
    } finally {
      await close();
    }
  }, 60_000);

  it("apply cleanly through 0018 (voice control plane) with legacy rows untouched", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const columns = (await db.execute(
        sql`select table_name, column_name, is_nullable, data_type, column_default
            from information_schema.columns
            where (table_name = 'voice_sessions' and column_name in ('runtime_instance_id', 'recovery_claimed_at'))
               or (table_name = 'voice_recordings' and column_name = 'timeline_version')
            order by table_name, column_name`,
      )) as unknown as Rows<{
        table_name: string;
        column_name: string;
        is_nullable: string;
        data_type: string;
        column_default: string | null;
      }>;
      expect(columns.rows).toEqual([
        {
          table_name: "voice_recordings",
          column_name: "timeline_version",
          is_nullable: "NO",
          data_type: "smallint",
          column_default: "1",
        },
        {
          table_name: "voice_sessions",
          column_name: "recovery_claimed_at",
          is_nullable: "YES",
          data_type: "timestamp with time zone",
          column_default: null,
        },
        {
          table_name: "voice_sessions",
          column_name: "runtime_instance_id",
          is_nullable: "YES",
          data_type: "text",
          column_default: null,
        },
      ]);

      await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Owner', 'o@example.com')`);
      await db.execute(sql`insert into assistants (id, public_id, user_id, name) values ('a1', 'pub_a1', 'u1', 'A')`);
      // Legacy-shaped inserts (new columns omitted).
      await db.execute(sql`insert into voice_sessions (id, assistant_id, provider) values ('v1', 'a1', 'gpt-live')`);
      await db.execute(sql`insert into voice_recordings (id, session_id, kind) values ('r1', 'v1', 'mix')`);
      const session = (await db.execute(
        sql`select runtime_instance_id, recovery_claimed_at from voice_sessions where id = 'v1'`,
      )) as unknown as Rows<{ runtime_instance_id: string | null; recovery_claimed_at: string | null }>;
      expect(session.rows).toEqual([{ runtime_instance_id: null, recovery_claimed_at: null }]);
      const recording = (await db.execute(
        sql`select timeline_version from voice_recordings where id = 'r1'`,
      )) as unknown as Rows<{ timeline_version: number }>;
      expect(recording.rows).toEqual([{ timeline_version: 1 }]);
    } finally {
      await close();
    }
  }, 60_000);

  it("apply cleanly through 0019 (scope outcome) with existing outcomes untouched", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const labels = (await db.execute(
        sql`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'message_outcome' order by e.enumsortorder`,
      )) as unknown as Rows<{ enumlabel: string }>;
      expect(labels.rows.map((row) => row.enumlabel)).toEqual([
        "answered_with_context",
        "fallback_no_context",
        "low_confidence",
        "retrieval_failure",
        "model_failure",
        "processing_failure",
        "conversational",
        "answered_from_history",
        "out_of_scope",
      ]);

      await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Owner', 'o@example.com')`);
      await db.execute(sql`insert into assistants (id, public_id, user_id, name) values ('a1', 'pub_a1', 'u1', 'A')`);
      await db.execute(sql`insert into conversations (id, assistant_id) values ('c1', 'a1')`);
      await db.execute(
        sql`insert into messages (id, conversation_id, role, content, outcome) values ('m1', 'c1', 'assistant', 'Redirect.', 'out_of_scope')`,
      );
      const rows = (await db.execute(sql`select outcome from messages where id = 'm1'`)) as unknown as Rows<{
        outcome: string;
      }>;
      expect(rows.rows).toEqual([{ outcome: "out_of_scope" }]);
    } finally {
      await close();
    }
  }, 60_000);

  it("apply cleanly through 0020 (assistant profile): one pending job per assistant, cascade on delete", async () => {
    const { db, close } = await createTestDatabase();
    try {
      await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Owner', 'o@example.com')`);
      await db.execute(sql`insert into assistants (id, public_id, user_id, name) values ('a1', 'pub_a1', 'u1', 'A')`);

      await db.execute(sql`insert into assistant_profiles (assistant_id) values ('a1')`);
      const profile = (await db.execute(
        sql`select version, purpose, facts, suggestions, dismissed, conflicts, refresh_status, refreshes_today
            from assistant_profiles where assistant_id = 'a1'`,
      )) as unknown as Rows<Record<string, unknown>>;
      expect(profile.rows).toEqual([
        {
          version: 1,
          purpose: null,
          facts: [],
          suggestions: [],
          dismissed: [],
          conflicts: [],
          refresh_status: "idle",
          refreshes_today: 0,
        },
      ]);

      // Same statement as enqueueProfileFactsJob: a second pending job is a no-op.
      const enqueue = (id: string) =>
        db.execute(sql`
          insert into assistant_profile_jobs (id, assistant_id, kind, reason, status, run_after)
          values (${id}, 'a1', 'facts', 'knowledge_change', 'pending', now() + (60000 * interval '1 millisecond'))
          on conflict (assistant_id, kind) where status = 'pending' do nothing
          returning id
        `) as unknown as Promise<Rows<{ id: string }>>;
      expect((await enqueue("j1")).rows).toEqual([{ id: "j1" }]);
      expect((await enqueue("j2")).rows).toEqual([]);

      // Once the first job is processing, a new pending job is allowed.
      await db.execute(sql`update assistant_profile_jobs set status = 'processing' where id = 'j1'`);
      expect((await enqueue("j3")).rows).toEqual([{ id: "j3" }]);
      // A retry cannot return to pending while a newer pending job exists.
      await expect(
        db.execute(sql`update assistant_profile_jobs set status = 'pending' where id = 'j1'`),
      ).rejects.toThrow();

      await db.execute(sql`delete from assistants where id = 'a1'`);
      const left = (await db.execute(
        sql`select (select count(*) from assistant_profiles)::int as profiles, (select count(*) from assistant_profile_jobs)::int as jobs`,
      )) as unknown as Rows<{ profiles: number; jobs: number }>;
      expect(left.rows).toEqual([{ profiles: 0, jobs: 0 }]);
    } finally {
      await close();
    }
  }, 60_000);
});
