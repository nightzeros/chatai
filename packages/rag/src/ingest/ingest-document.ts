import { embedMany, type EmbeddingConfig, type ProviderUsage } from "@chatai/ai";
import { assistants, chunks, documents, eq, type Database } from "@chatai/database";
import { nanoid } from "nanoid";

import { resolveRagSettings } from "../answer/rag-settings";
import { chunkBlocks } from "./chunk";
import { shouldSkipReembed } from "./hash";
import { defaultLoaderContext, getLoader, loaderTypeForDocument } from "./loaders";

export async function ingestDocument(opts: {
  documentId: string;
  db: Database;
  embedding: EmbeddingConfig;
  force?: boolean;
  /**
   * Called after chunking and before `embedMany`.
   * Hosted enforcement uses this to reserve estimated embedding cost.
   */
  beforeEmbed?: (info: {
    chunkCount: number;
    approxTokens: number;
    texts: string[];
  }) => Promise<void>;
}): Promise<{ chunkCount: number; skipped?: boolean; embeddingUsage?: ProviderUsage }> {
  const [row] = await opts.db
    .select({
      document: documents,
      ragSettings: assistants.ragSettings,
    })
    .from(documents)
    .innerJoin(assistants, eq(assistants.id, documents.assistantId))
    .where(eq(documents.id, opts.documentId))
    .limit(1);

  const document = row?.document;

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

  const chunkingMode = resolveRagSettings(row?.ragSettings).chunkingMode;
  const chunked = chunkBlocks(blocks, chunkingMode);
  if (chunked.length === 0) {
    throw new Error("Document produced no chunks.");
  }

  const texts = chunked.map((chunk) => chunk.content);
  const approxTokens = Math.max(
    1,
    texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
  );

  if (opts.beforeEmbed) {
    await opts.beforeEmbed({ chunkCount: chunked.length, approxTokens, texts });
  }

  const embedResult = await embedMany(texts, opts.embedding);
  const embeddings = embedResult.embeddings;

  if (embeddings.length !== chunked.length) {
    throw new Error("Embedding count did not match chunk count.");
  }

  await opts.db.delete(chunks).where(eq(chunks.documentId, document.id));

  const parentFirstId = new Map<number, string>();
  const rows = chunked.map((chunk, index) => {
    const id = nanoid();
    const parentIndex = chunk.metadata.parentIndex;
    let parentChunkId: string | null = null;

    if (parentIndex !== undefined) {
      const existingParentId = parentFirstId.get(parentIndex);
      if (existingParentId) {
        parentChunkId = existingParentId;
      } else {
        parentFirstId.set(parentIndex, id);
      }
    }

    return {
      id,
      documentId: document.id,
      assistantId: document.assistantId,
      content: chunk.content,
      embedding: embeddings[index] ?? [],
      metadata: chunk.metadata,
      parentChunkId,
      parentContent: chunk.parentContent ?? null,
    };
  });

  await opts.db.insert(chunks).values(rows);

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

  return { chunkCount: chunked.length, embeddingUsage: embedResult.usage };
}
