import { embedMany, type EmbeddingConfig } from "@chatai/ai";
import { chunks, documents, eq, type Database } from "@chatai/database";
import { nanoid } from "nanoid";

import { chunkBlocks } from "./chunk";
import { shouldSkipReembed } from "./hash";
import { defaultLoaderContext, getLoader, loaderTypeForDocument } from "./loaders";

export async function ingestDocument(opts: {
  documentId: string;
  db: Database;
  embedding: EmbeddingConfig;
  force?: boolean;
}): Promise<{ chunkCount: number; skipped?: boolean }> {
  const [document] = await opts.db
    .select()
    .from(documents)
    .where(eq(documents.id, opts.documentId))
    .limit(1);

  if (!document) {
    throw new Error(`Document ${opts.documentId} not found.`);
  }

  await opts.db
    .update(documents)
    .set({ status: "processing", error: null, updatedAt: new Date() })
    .where(eq(documents.id, document.id));

  const loader = getLoader(loaderTypeForDocument(document.type));
  const { blocks, contentHash } = await loader.extract(
    {
      key: document.id,
      name: document.name,
      url: document.url ?? undefined,
      mimeType: document.mimeType,
      storagePath: document.storagePath,
      content: document.content,
    },
    defaultLoaderContext,
  );

  if (blocks.length === 0) {
    throw new Error("No text could be extracted from this document.");
  }

  if (
    shouldSkipReembed({
      storedHash: document.contentHash,
      nextHash: contentHash,
      chunkCount: document.chunkCount,
      force: opts.force,
    })
  ) {
    await opts.db
      .update(documents)
      .set({
        status: "ready",
        error: null,
        contentHash,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));
    return { chunkCount: document.chunkCount, skipped: true };
  }

  const chunked = chunkBlocks(blocks);
  if (chunked.length === 0) {
    throw new Error("Document produced no chunks.");
  }

  const embeddings = await embedMany(
    chunked.map((chunk) => chunk.content),
    opts.embedding,
  );

  if (embeddings.length !== chunked.length) {
    throw new Error("Embedding count did not match chunk count.");
  }

  await opts.db.delete(chunks).where(eq(chunks.documentId, document.id));

  await opts.db.insert(chunks).values(
    chunked.map((chunk, index) => ({
      id: nanoid(),
      documentId: document.id,
      assistantId: document.assistantId,
      content: chunk.content,
      embedding: embeddings[index] ?? [],
      metadata: chunk.metadata,
    })),
  );

  await opts.db
    .update(documents)
    .set({
      status: "ready",
      error: null,
      chunkCount: chunked.length,
      contentHash,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, document.id));

  return { chunkCount: chunked.length };
}
