import { eq, sources, type WebsiteSourceConfig } from "@chatai/database";
import {
  clampWebsiteConfig,
  normalizeSourceStartUrl,
  normalizeWebsiteOriginKey,
} from "@chatai/rag";

import { db } from "@/lib/db";
import { createId } from "@/lib/ids";

export const DUPLICATE_WEBSITE_SOURCE_MESSAGE = "This website has already been added.";

export class DuplicateWebsiteSourceError extends Error {
  constructor(message = DUPLICATE_WEBSITE_SOURCE_MESSAGE) {
    super(message);
    this.name = "DuplicateWebsiteSourceError";
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export function sourceNameFromUrl(startUrl: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`);
    return url.hostname;
  } catch {
    return startUrl.slice(0, 120);
  }
}

export function buildWebsiteSourceConfig(input: {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
}): { originKey: string; config: WebsiteSourceConfig } {
  const normalizedStartUrl = normalizeSourceStartUrl(input.startUrl);
  const originKey = normalizeWebsiteOriginKey(input.startUrl);
  const config = clampWebsiteConfig({
    startUrl: normalizedStartUrl,
    maxPages: input.maxPages,
    maxDepth: input.maxDepth,
  });

  return { originKey, config };
}

export async function createWebsiteSource(opts: {
  assistantId: string;
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
}) {
  const sourceId = createId();
  const { originKey, config } = buildWebsiteSourceConfig(opts);

  try {
    await db().insert(sources).values({
      id: sourceId,
      assistantId: opts.assistantId,
      type: "website",
      name: sourceNameFromUrl(config.startUrl),
      originKey,
      config,
      status: "pending",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateWebsiteSourceError();
    }
    throw error;
  }

  const [source] = await db().select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) {
    throw new Error("Failed to create website source.");
  }

  return source;
}
