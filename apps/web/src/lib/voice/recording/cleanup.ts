import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  and,
  assistants,
  eq,
  inArray,
  isNotNull,
  lt,
  resolveVoiceSettings,
  voiceRecordingCleanupRefs,
  voiceRecordings,
  voiceSessions,
} from "@chatai/database";

import { db } from "@/lib/db";
import { getObjectStorage } from "@/lib/storage/object-storage";

import { VOICE_RUNTIME_MAX_MS } from "../lifecycle";
import {
  activeRecordingIds,
  publishSpooledRecording,
  recordingPreSkip,
  recordingSpoolDir,
  recordingSpoolPath,
} from "./service";

/** A pending row this old with no in-process owner was orphaned by a restart. */
const ORPHAN_GRACE_MS = 2 * 60 * 1000;
/** Upper bound for a legitimately pending recording (session cap + finalize/upload). */
const MAX_PENDING_MS = VOICE_RUNTIME_MAX_MS + 10 * 60 * 1000;

async function deleteObject(key: string): Promise<boolean> {
  const storage = getObjectStorage();
  if (!storage) return false;
  try {
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove recordings attached to conversations that are about to be deleted:
 * object first, then row. An object that cannot be deleted right now leaves a
 * detached `deleting` row that the maintenance pass retries. Never throws, so a
 * storage outage cannot block a privacy deletion.
 */
export async function releaseConversationRecordings(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  try {
    const rows = await db()
      .select({
        id: voiceRecordings.id,
        sessionId: voiceRecordings.sessionId,
        storageKey: voiceRecordings.storageKey,
        conversationId: voiceRecordings.conversationId,
      })
      .from(voiceRecordings)
      .where(inArray(voiceRecordings.conversationId, conversationIds));
    const withObject = new Set(voiceRecordingCleanupRefs(rows).map((ref) => ref.recordingId));

    for (const row of rows) {
      if (!withObject.has(row.id) || (await deleteObject(row.storageKey!))) {
        await db().delete(voiceRecordings).where(eq(voiceRecordings.id, row.id));
      } else {
        await db()
          .update(voiceRecordings)
          .set({ status: "deleting", conversationId: null, updatedAt: new Date() })
          .where(eq(voiceRecordings.id, row.id));
      }
    }
  } catch (error) {
    console.error(
      "[voice-recording] release before conversation delete failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Assistant deletion cascades every recording row, leaving nothing to retry, so
 * all objects must be deleted first. Returns false if any delete failed; the
 * caller must then abort the assistant deletion.
 */
export async function deleteAssistantRecordingObjects(assistantId: string): Promise<boolean> {
  const rows = await db()
    .select({
      id: voiceRecordings.id,
      sessionId: voiceRecordings.sessionId,
      storageKey: voiceRecordings.storageKey,
      conversationId: voiceRecordings.conversationId,
    })
    .from(voiceRecordings)
    .innerJoin(voiceSessions, eq(voiceRecordings.sessionId, voiceSessions.id))
    .where(and(eq(voiceSessions.assistantId, assistantId), isNotNull(voiceRecordings.storageKey)));
  const refs = voiceRecordingCleanupRefs(rows);
  if (refs.length === 0) return true;
  if (!getObjectStorage()) return false;
  for (const ref of refs) {
    if (!(await deleteObject(ref.storageKey))) return false;
    await db().update(voiceRecordings).set({ storageKey: null }).where(eq(voiceRecordings.id, ref.recordingId));
  }
  return true;
}

export type RecordingMaintenanceResult = {
  recovered: number;
  failed: number;
  deleted: number;
  expired: number;
  spoolsRemoved: number;
};

/**
 * Periodic pass (privacy worker): recover recordings orphaned by a restart,
 * retry pending object deletes, apply recording retention, clear stray spools.
 */
export async function runRecordingMaintenance(now = new Date()): Promise<RecordingMaintenanceResult> {
  const result: RecordingMaintenanceResult = {
    recovered: 0,
    failed: 0,
    deleted: 0,
    expired: 0,
    spoolsRemoved: 0,
  };
  const active = activeRecordingIds();

  // 1. Crash recovery: finalize what the compressed spool holds, as `partial`.
  const pending = await db()
    .select({
      id: voiceRecordings.id,
      storageKey: voiceRecordings.storageKey,
      createdAt: voiceRecordings.createdAt,
      voiceSettings: assistants.voiceSettings,
    })
    .from(voiceRecordings)
    .innerJoin(voiceSessions, eq(voiceRecordings.sessionId, voiceSessions.id))
    .innerJoin(assistants, eq(voiceSessions.assistantId, assistants.id))
    .where(
      and(
        eq(voiceRecordings.status, "pending"),
        lt(voiceRecordings.createdAt, new Date(now.getTime() - ORPHAN_GRACE_MS)),
      ),
    );
  for (const row of pending) {
    const ageMs = now.getTime() - row.createdAt.getTime();
    if (active.has(row.id) && ageMs < MAX_PENDING_MS) continue;
    const spoolPath = recordingSpoolPath(row.id);
    const hasSpool = await stat(spoolPath).then(
      () => true,
      () => false,
    );
    if (!hasSpool || !row.storageKey) {
      await db()
        .update(voiceRecordings)
        .set({ status: "failed", errorCode: "recording_interrupted", updatedAt: now })
        .where(and(eq(voiceRecordings.id, row.id), eq(voiceRecordings.status, "pending")));
      result.failed += 1;
      continue;
    }
    active.add(row.id);
    try {
      const published = await publishSpooledRecording({
        recordingId: row.id,
        storageKey: row.storageKey,
        spoolPath,
        preSkip: await recordingPreSkip(),
        partial: true,
        retentionDays: resolveVoiceSettings(row.voiceSettings).recordingRetentionDays,
      });
      if (published === "ready") result.recovered += 1;
      else if (published === "failed") result.failed += 1;
    } finally {
      active.delete(row.id);
    }
  }

  // 2. Retry object deletes left by conversation deletion during a storage outage.
  const deleting = await db()
    .select({ id: voiceRecordings.id, storageKey: voiceRecordings.storageKey })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.status, "deleting"));
  for (const row of deleting) {
    if (!row.storageKey || (await deleteObject(row.storageKey))) {
      await db().delete(voiceRecordings).where(eq(voiceRecordings.id, row.id));
      result.deleted += 1;
    }
  }

  // 3. Recording retention: delete the object, keep an `expired` tombstone.
  const expired = await db()
    .select({ id: voiceRecordings.id, storageKey: voiceRecordings.storageKey })
    .from(voiceRecordings)
    .where(and(eq(voiceRecordings.status, "ready"), lt(voiceRecordings.expiresAt, now)));
  for (const row of expired) {
    if (row.storageKey && !(await deleteObject(row.storageKey))) continue;
    await db()
      .update(voiceRecordings)
      .set({ status: "expired", storageKey: null, deletedAt: now, updatedAt: now })
      .where(eq(voiceRecordings.id, row.id));
    result.expired += 1;
  }

  // 4. Spool files whose recording is gone (deleted, failed, finished elsewhere).
  const dir = recordingSpoolDir();
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const file of files) {
    const id = file.split(".")[0]!;
    if (active.has(id)) continue;
    const full = path.join(dir, file);
    const info = await stat(full).catch(() => null);
    if (!info || now.getTime() - info.mtimeMs < ORPHAN_GRACE_MS) continue;
    const [row] = await db()
      .select({ status: voiceRecordings.status })
      .from(voiceRecordings)
      .where(eq(voiceRecordings.id, id))
      .limit(1);
    if (row?.status === "pending") continue;
    await rm(full, { force: true }).catch(() => undefined);
    result.spoolsRemoved += 1;
  }

  return result;
}
