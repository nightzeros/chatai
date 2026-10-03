import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

import { VOICE_RUNTIME_MAX_MS } from "./lifecycle";

/** Outlives the runtime cap so a late heartbeat still learns how the call ended. */
export const CONTROL_TOKEN_TTL_MS = VOICE_RUNTIME_MAX_MS + 10 * 60 * 1000;

type ControlClaims = { s: string; v: string | null; e: number };

function signingKey(): Buffer | null {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update("chatai:voice-control:v1").digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * Per-session control token: authorizes heartbeats for exactly one Voice session.
 * Not a provider credential. Null when the instance has no signing secret.
 */
export function createVoiceControlToken(input: {
  sessionId: string;
  visitorId: string | null;
  now?: number;
}): string | null {
  const key = signingKey();
  if (!key) return null;
  const claims: ControlClaims = {
    s: input.sessionId,
    v: input.visitorId,
    e: (input.now ?? Date.now()) + CONTROL_TOKEN_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

/** Valid, unexpired and minted for this session; returns the bound visitor id. */
export function verifyVoiceControlToken(
  token: string | null | undefined,
  sessionId: string,
  now: number = Date.now(),
): { ok: true; visitorId: string | null } | { ok: false } {
  const key = signingKey();
  if (!key || !token || token.length > 1_024) return { ok: false };
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return { ok: false };
  const want = Buffer.from(sign(payload, key));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false };
  let claims: ControlClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ControlClaims;
  } catch {
    return { ok: false };
  }
  if (claims.s !== sessionId || typeof claims.e !== "number" || claims.e <= now) return { ok: false };
  return { ok: true, visitorId: typeof claims.v === "string" ? claims.v : null };
}
