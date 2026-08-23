import { getOpenApiDocument } from "@chatai/sdk";

export function GET() {
  return Response.json(getOpenApiDocument(), {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
}
