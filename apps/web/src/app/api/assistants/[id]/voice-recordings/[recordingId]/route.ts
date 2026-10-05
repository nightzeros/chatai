import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import {
  createPlaybackToken,
  getOwnedRecording,
  toVoiceRecordingView,
} from "@/lib/voice/recording/playback";

type RouteContext = { params: Promise<{ id: string; recordingId: string }> };

const noStore = { "Cache-Control": "no-store" };

/**
 * Owner-only recording status plus, when playable, a short-lived relative
 * playback URL. Storage keys, bucket names and endpoints never leave the server.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }
  const { id, recordingId } = await context.params;
  const row = await getOwnedRecording({ userId: session.user.id, assistantId: id, recordingId });
  const recording = row ? toVoiceRecordingView(row) : null;
  if (!row || !recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404, headers: noStore });
  }

  let playback: { url: string; expiresAt: string } | null = null;
  if (recording.status === "ready" && row.storageKey) {
    const token = createPlaybackToken({ recordingId, userId: session.user.id });
    if (token) {
      playback = {
        url: `/api/assistants/${encodeURIComponent(id)}/voice-recordings/${encodeURIComponent(recordingId)}/stream?token=${encodeURIComponent(token.token)}`,
        expiresAt: new Date(token.expiresAt).toISOString(),
      };
    }
  }

  return NextResponse.json({ recording, playback }, { headers: noStore });
}
