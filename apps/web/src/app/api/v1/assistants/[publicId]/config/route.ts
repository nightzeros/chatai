import { assistants, eq } from "@chatai/database";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await context.params;
  const [assistant] = await db()
    .select({
      publicId: assistants.publicId,
      name: assistants.name,
      welcomeMessage: assistants.welcomeMessage,
      settings: assistants.settings,
    })
    .from(assistants)
    .where(eq(assistants.publicId, publicId))
    .limit(1);

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  return jsonWithCors({
    assistantId: assistant.publicId,
    name: assistant.name,
    welcomeMessage: assistant.welcomeMessage,
    settings: assistant.settings,
  });
}
