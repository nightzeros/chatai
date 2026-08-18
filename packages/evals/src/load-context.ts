import {
  chunks,
  conversations,
  desc,
  eq,
  inArray,
  messages,
  type Database,
  type MessageDebug,
} from "@chatai/database";
import { buildContextBlocks, type RetrievedChunk } from "@chatai/rag/answer";

import type { EvalContext } from "./types";
import { contextChunksForEval, toEvalDebugRetrieval } from "./eval-retrieval";

export async function loadOnlineEvalContext(
  db: Database,
  messageId: string,
): Promise<{
  assistantId: string;
  context: EvalContext;
  retrieved: RetrievedChunk[];
  debug?: MessageDebug;
  outcome?: string;
} | null> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message || message.role !== "assistant") {
    return null;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
    .limit(1);

  if (!conversation) {
    return null;
  }

  const debug = (message.debug ?? {}) as MessageDebug;
  const retrieval = debug.retrieval ?? [];
  const chunkIds = retrieval.map((item) => item.chunkId);
  const chunkRows =
    chunkIds.length > 0
      ? await db
          .select({
            id: chunks.id,
            content: chunks.content,
            parentContent: chunks.parentContent,
          })
          .from(chunks)
          .where(inArray(chunks.id, chunkIds))
      : [];

  const chunkById = new Map(chunkRows.map((row) => [row.id, row]));
  const retrieved: RetrievedChunk[] = retrieval
    .map((item) => {
      const row = chunkById.get(item.chunkId);
      if (!row) return null;
      return {
        chunkId: item.chunkId,
        documentId: item.documentId,
        documentName: item.documentName,
        content: row.content,
        similarity: item.similarity,
        ...(row.parentContent ? { parentContent: row.parentContent } : {}),
      };
    })
    .filter((item): item is RetrievedChunk => item !== null);

  const contextChunks = contextChunksForEval(retrieved);

  let question = typeof debug.question === "string" ? debug.question : "";
  if (!question) {
    const prior = await db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, message.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(10);

    const lastUser = prior.find((row) => row.role === "user");
    question = lastUser?.content ?? "";
  }

  return {
    assistantId: conversation.assistantId,
    context: {
      question,
      answer: message.content,
      context: buildContextBlocks(contextChunks),
      sources: message.sources ?? [],
      retrieval: toEvalDebugRetrieval(contextChunks),
    },
    retrieved: contextChunks,
    debug,
    ...(message.outcome ? { outcome: message.outcome } : {}),
  };
}
