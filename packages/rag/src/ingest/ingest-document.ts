import { embedMany, type EmbeddingConfig } from "@chatai/ai";
import { chunks, documents, eq, type Database } from "@chatai/database";
import { nanoid } from "nanoid";

import { chunkBlocks } from "./chunk";
import { extractFromFile, extractFromText } from "./extract";

export async function ingestDocument(opts: {
  documentId: string;
  db: Database;
  embedding: EmbeddingConfig;
}): Promise<{ chunkCount: number }> {
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

  const blocks =
    document.type === "file"
      ? await extractFromFile({
          storagePath: document.storagePath ?? "",
          mimeType: document.mimeType,
          name: document.name,
        })
      : extractFromText(document.content ?? "");

  if (blocks.length === 0) {
    throw new Error("No text could be extracted from this document.");
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
      updatedAt: new Date(),
    })
    .where(eq(documents.id, document.id));

  return { chunkCount: chunked.length };
}
