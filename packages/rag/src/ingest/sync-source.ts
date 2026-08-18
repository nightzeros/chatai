import { and, documents, eq, ingestJobs, sources, type Database } from "@chatai/database";
import type { WebsiteSourceConfig } from "@chatai/database";
import { nanoid } from "nanoid";

import { defaultLoaderContext, getLoader } from "./loaders";

export async function syncSource(opts: { sourceId: string; db: Database }) {
  const [source] = await opts.db
    .select()
    .from(sources)
    .where(eq(sources.id, opts.sourceId))
    .limit(1);

  if (!source) {
    throw new Error(`Source ${opts.sourceId} not found.`);
  }

  await opts.db
    .update(sources)
    .set({ status: "syncing", error: null, updatedAt: new Date() })
    .where(eq(sources.id, source.id));

  try {
    const loader = getLoader("website");
    const config = source.config as WebsiteSourceConfig;
    const items = await loader.discover(config, defaultLoaderContext);

    if (items.length === 0) {
      throw new Error("No pages discovered for this website.");
    }

    let enqueued = 0;
    for (const item of items) {
      if (!item.url) continue;

      const [existing] = await opts.db
        .select()
        .from(documents)
        .where(and(eq(documents.sourceId, source.id), eq(documents.url, item.url)))
        .limit(1);

      if (existing?.excluded) continue;

      let documentId = existing?.id;
      if (existing) {
        await opts.db
          .update(documents)
          .set({
            name: item.name,
            status: "pending",
            error: null,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, existing.id));
      } else {
        documentId = nanoid();
        await opts.db.insert(documents).values({
          id: documentId,
          assistantId: source.assistantId,
          sourceId: source.id,
          type: "url",
          name: item.name,
          url: item.url,
          status: "pending",
        });
      }

      if (!documentId) continue;

      await opts.db.insert(ingestJobs).values({
        id: nanoid(),
        kind: "ingest",
        documentId,
        sourceId: source.id,
        status: "pending",
        attempts: 0,
      });
      enqueued += 1;
    }

    if (enqueued === 0) {
      throw new Error("No pages were queued for ingestion.");
    }

    await opts.db
      .update(sources)
      .set({
        status: "ready",
        error: null,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sources.id, source.id));

    return { discovered: items.length, enqueued };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website sync failed.";
    await opts.db
      .update(sources)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, source.id));
    throw error;
  }
}
