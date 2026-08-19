export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function jsonWithCors(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { ...corsHeaders, ...init?.headers },
  });
}
