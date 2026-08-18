import { assertSafeUrl } from "@chatai/rag";
import { NextResponse } from "next/server";

import { getOwnedAssistant } from "@/lib/assistants";
import { enqueueSourceSync } from "@/lib/enqueue-ingest";
import { requireSession } from "@/lib/session";
import {
  createWebsiteSource,
  DuplicateWebsiteSourceError,
  DUPLICATE_WEBSITE_SOURCE_MESSAGE,
  listSourcesForAssistant,
} from "@/lib/sources";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const rows = await listSourcesForAssistant(assistant.id);
  return NextResponse.json({ sources: rows });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    startUrl?: string;
    maxPages?: number;
    maxDepth?: number;
  } | null;

  const startUrl = body?.startUrl?.trim();
  if (!startUrl) {
    return NextResponse.json({ error: "Website URL is required." }, { status: 400 });
  }

  try {
    await assertSafeUrl(startUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid website URL.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const source = await createWebsiteSource({
      assistantId: assistant.id,
      startUrl,
      maxPages: body?.maxPages,
      maxDepth: body?.maxDepth,
    });

    await enqueueSourceSync(source.id);
    return NextResponse.json({ source });
  } catch (error) {
    if (error instanceof DuplicateWebsiteSourceError) {
      return NextResponse.json({ error: DUPLICATE_WEBSITE_SOURCE_MESSAGE }, { status: 409 });
    }
    throw error;
  }
}
