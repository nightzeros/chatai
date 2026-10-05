import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { getObjectStorage } from "@/lib/storage/object-storage";
import { getOwnedRecording, verifyPlaybackToken } from "@/lib/voice/recording/playback";

type RouteContext = { params: Promise<{ id: string; recordingId: string }> };

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function error(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

type ParsedRange = { start: number; end?: number } | { suffix: number } | null | "invalid";

function parseRange(header: string | null): ParsedRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  if (!match[1]) return { suffix: Number(match[2]) };
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (end !== undefined && end < start) return "invalid";
  return { start, end };
}

/**
 * Owner-only audio proxy with HTTP Range support. Requires both the signed-in
 * owner and a short-lived token bound to this recording and user, so a copied
 * URL stops working after expiry or sign-out.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) return error(401, "Unauthorized.");
  const { id, recordingId } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  if (!verifyPlaybackToken(token, { recordingId, userId: session.user.id })) {
    return error(403, "Playback link expired.");
  }

  const row = await getOwnedRecording({ userId: session.user.id, assistantId: id, recordingId });
  if (!row) return error(404, "Recording not found.");
  if (row.status === "expired") return error(410, "Recording was deleted by the retention setting.");
  if (row.status !== "ready" || !row.storageKey) return error(404, "Recording is not available.");

  const storage = getObjectStorage();
  if (!storage) return error(503, "Recording storage is not configured.");

  let range = parseRange(request.headers.get("range"));
  if (range === "invalid") return error(416, "Invalid range.");
  if (range && "suffix" in range) {
    const head = await storage.head(row.storageKey);
    if (!head) return error(404, "Recording is no longer available.");
    range = { start: Math.max(0, head.byteSize - range.suffix) };
  }

  let object;
  try {
    object = await storage.get(row.storageKey, range ?? undefined);
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 416) return error(416, "Range not satisfiable.");
    return error(502, "Recording storage is unavailable.");
  }
  if (!object) return error(404, "Recording is no longer available.");

  const headers: Record<string, string> = {
    ...privateHeaders,
    "Content-Type": row.contentType ?? "audio/webm",
    "Accept-Ranges": "bytes",
    "Content-Length": String(object.contentLength),
    "Content-Disposition": "inline",
  };
  if (object.range) {
    headers["Content-Range"] = `bytes ${object.range.start}-${object.range.end}/${object.byteSize}`;
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}
