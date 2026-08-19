import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "sk_live_";

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKeySecret(): { secret: string; prefix: string } {
  const random = randomBytes(24).toString("base64url");
  const secret = `${KEY_PREFIX}${random}`;
  const prefix = secret.slice(0, 12);
  return { secret, prefix };
}

export function parseBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();
  if (!token.startsWith("sk_")) {
    return null;
  }
  return token;
}

/** True when the request should use API-key auth instead of the keyless widget path. */
export function usesApiKeyAuth(request: Request) {
  return parseBearerToken(request) !== null;
}
