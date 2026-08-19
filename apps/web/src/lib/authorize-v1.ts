import { apiKeys, eq, type ApiKeyScope } from "@chatai/database";

import { authorizeApiKeyRecord, type V1AuthContext, type V1AuthFailure, type V1AuthResult } from "@/lib/api-key-auth";
import { hashApiKey, parseBearerToken } from "@/lib/api-keys";
import { db } from "@/lib/db";

export type { V1AuthContext, V1AuthFailure, V1AuthResult };
export { authorizeApiKeyRecord, hasApiKeyScope } from "@/lib/api-key-auth";

export async function authorizeV1(
  request: Request,
  requiredScopes: ApiKeyScope[] = [],
): Promise<V1AuthResult> {
  const token = parseBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header." };
  }

  const keyHash = hashApiKey(token);
  const [row] = await db()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  const result = authorizeApiKeyRecord(row, requiredScopes);
  if (!result.ok) {
    return result;
  }

  await db()
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, result.apiKeyId));

  return result;
}
