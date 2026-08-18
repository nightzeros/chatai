import { getOpenApiDocument } from "@chatai/sdk";

import { corsHeaders, jsonWithCors } from "@/lib/cors";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  return jsonWithCors(getOpenApiDocument());
}
