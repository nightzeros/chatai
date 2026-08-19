import { API_KEY_SCOPES, type ApiKeyScope } from "@chatai/database";

export type V1AuthContext = {
  userId: string;
  apiKeyId: string;
  scopes: ApiKeyScope[];
};

export type V1AuthFailure = {
  ok: false;
  status: 401 | 403;
  error: string;
};

export type V1AuthResult = ({ ok: true } & V1AuthContext) | V1AuthFailure;

function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

export function hasApiKeyScope(scopes: ApiKeyScope[], required: ApiKeyScope) {
  return scopes.includes(required);
}

export function authorizeApiKeyRecord(
  row:
    | {
        id: string;
        userId: string;
        scopes: ApiKeyScope[];
        revokedAt: Date | null;
      }
    | undefined,
  requiredScopes: ApiKeyScope[] = [],
): V1AuthResult {
  if (!row || row.revokedAt) {
    return { ok: false, status: 401, error: "Invalid API key." };
  }

  const scopes = row.scopes.filter(isApiKeyScope);
  for (const scope of requiredScopes) {
    if (!hasApiKeyScope(scopes, scope)) {
      return { ok: false, status: 403, error: `Missing required scope: ${scope}` };
    }
  }

  return {
    ok: true,
    userId: row.userId,
    apiKeyId: row.id,
    scopes,
  };
}
