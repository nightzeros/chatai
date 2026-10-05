import { createHmac, timingSafeEqual } from "node:crypto";

import {
  and,
  assistants,
  desc,
  eq,
  voiceRecordings,
  voiceSessions,
  type VoiceRecordingStatus,
} from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Playback URLs are useless after this, and only for the same signed-in owner. */
export const PLAYBACK_TOKEN_TTL_MS = 10 * 60 * 1000;

type TokenClaims = { r: string; u: string; e: number };

function signingKey(): Buffer | null {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("chatai:voice-recording-playback:v1").digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createPlaybackToken(input: {
  recordingId: string;
  userId: string;
  now?: number;
}): { token: string; expiresAt: number } | null {
  const key = signingKey();
  if (!key) return null;
  const expiresAt = (input.now ?? Date.now()) + PLAYBACK_TOKEN_TTL_MS;
  const payload = b64url(JSON.stringify({ r: input.recordingId, u: input.userId, e: expiresAt }));
  return { token: `${payload}.${sign(payload, key)}`, expiresAt };
}

export function verifyPlaybackToken(
  token: string | null,
  expected: { recordingId: string; userId: string; now?: number },
): boolean {
  const key = signingKey();
  if (!key || !token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  const want = Buffer.from(sign(payload, key));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
  } catch {
    return false;
  }
  return (
    claims.r === expected.recordingId &&
    claims.u === expected.userId &&
    typeof claims.e === "number" &&
    claims.e > (expected.now ?? Date.now())
  );
}

/** Owner-facing recording metadata. Never includes the storage key, bucket or endpoint. */
export type VoiceRecordingView = {
  id: string;
  status: Exclude<VoiceRecordingStatus, "deleting">;
  partial: boolean;
  durationMs: number | null;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
  /** How turn offsets map onto this audio (1 = legacy, 2 = provider media clock). */
  timelineVersion: number;
};

type RecordingRow = {
  id: string;
  status: VoiceRecordingStatus;
  partial: boolean;
  durationMs: number | null;
  createdAt: Date;
  expiresAt: Date | null;
  deletedAt: Date | null;
  timelineVersion?: number | null;
};

export function toVoiceRecordingView(row: RecordingRow): VoiceRecordingView | null {
  if (row.status === "deleting") return null;
  return {
    id: row.id,
    status: row.status,
    partial: row.partial,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    timelineVersion: row.timelineVersion ?? 1,
  };
}

const viewColumns = {
  id: voiceRecordings.id,
  status: voiceRecordings.status,
  partial: voiceRecordings.partial,
  durationMs: voiceRecordings.durationMs,
  createdAt: voiceRecordings.createdAt,
  expiresAt: voiceRecordings.expiresAt,
  deletedAt: voiceRecordings.deletedAt,
  timelineVersion: voiceRecordings.timelineVersion,
};

/** Recordings on a conversation the caller has already verified they own. */
export async function listConversationRecordings(conversationId: string): Promise<VoiceRecordingView[]> {
  const rows = await db()
    .select(viewColumns)
    .from(voiceRecordings)
    .where(eq(voiceRecordings.conversationId, conversationId))
    .orderBy(desc(voiceRecordings.createdAt));
  return rows.flatMap((row) => toVoiceRecordingView(row) ?? []);
}

/** A recording that belongs to `assistantId`, owned by `userId`; null otherwise. */
export async function getOwnedRecording(input: {
  userId: string;
  assistantId: string;
  recordingId: string;
}): Promise<(RecordingRow & { storageKey: string | null; contentType: string | null }) | null> {
  const [row] = await db()
    .select({
      ...viewColumns,
      storageKey: voiceRecordings.storageKey,
      contentType: voiceRecordings.contentType,
    })
    .from(voiceRecordings)
    .innerJoin(voiceSessions, eq(voiceRecordings.sessionId, voiceSessions.id))
    .innerJoin(assistants, eq(voiceSessions.assistantId, assistants.id))
    .where(
      and(
        eq(voiceRecordings.id, input.recordingId),
        eq(assistants.id, input.assistantId),
        eq(assistants.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
