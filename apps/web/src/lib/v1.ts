import type { ApiKeyScope } from "@chatai/database";

import { authorizeV1, type V1AuthContext } from "@/lib/authorize-v1";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { consumeApiKeyRateLimit } from "@/lib/rate-limit";

export function v1Options() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function isV1Error(result: { auth: V1AuthContext } | Response): result is Response {
  return result instanceof Response;
}

export async function requireV1(
  request: Request,
  scopes: ApiKeyScope[],
): Promise<{ auth: V1AuthContext } | Response> {
  const auth = await authorizeV1(request, scopes);
  if (!auth.ok) {
    return jsonWithCors({ error: auth.error }, { status: auth.status });
  }

  const limited = await consumeApiKeyRateLimit(auth.apiKeyId);
  if (!limited.ok) {
    return jsonWithCors(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  return { auth };
}
