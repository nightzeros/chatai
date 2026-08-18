import type { Chunk, ExtractedBlock } from "./types";

/** ~4 characters per token is a stable approximation without a tokenizer. */
const CHARS_PER_TOKEN = 4;

export const STANDARD_TARGET_TOKENS = 500;
export const STANDARD_OVERLAP_TOKENS = 50;
export const PARENT_TARGET_TOKENS = 800;
export const CHILD_TARGET_TOKENS = 200;
export const CHILD_OVERLAP_TOKENS = 25;

const STANDARD_TARGET_CHARS = STANDARD_TARGET_TOKENS * CHARS_PER_TOKEN;
const STANDARD_OVERLAP_CHARS = STANDARD_OVERLAP_TOKENS * CHARS_PER_TOKEN;
const PARENT_TARGET_CHARS = PARENT_TARGET_TOKENS * CHARS_PER_TOKEN;
const CHILD_TARGET_CHARS = CHILD_TARGET_TOKENS * CHARS_PER_TOKEN;
const CHILD_OVERLAP_CHARS = CHILD_OVERLAP_TOKENS * CHARS_PER_TOKEN;

export type ChunkingMode = "standard" | "parent_child";

function splitOversized(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (!sentence) continue;
    if ((current + " " + sentence).trim().length <= maxChars) {
      current = current ? `${current} ${sentence}` : sentence;
      continue;
    }
    if (current) {
      parts.push(current);
      current = "";
    }
    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }
    for (let i = 0; i < sentence.length; i += maxChars) {
      parts.push(sentence.slice(i, i + maxChars));
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function prepareBlocks(blocks: ExtractedBlock[]) {
  return blocks
    .map((block) => ({ ...block, content: block.content.trim() }))
    .filter((block) => block.content.length > 0);
}

function chunkTextSegments(
  segments: string[],
  targetChars: number,
  overlapChars: number,
  metadata: Chunk["metadata"],
): Chunk[] {
  const chunks: Chunk[] = [];

  for (const segment of segments) {
    const pieces = splitOversized(segment, targetChars);
    for (const piece of pieces) {
      const previous = chunks.at(-1);
      if (previous && previous.content.length + 1 + piece.length <= targetChars) {
        previous.content = `${previous.content}\n\n${piece}`;
        continue;
      }

      const overlap =
        previous && overlapChars > 0 ? previous.content.slice(-overlapChars).trim() : "";
      const content = overlap ? `${overlap}\n${piece}` : piece;
      chunks.push({
        content: content.slice(0, targetChars + overlapChars),
        metadata: { ...metadata },
      });
    }
  }

  return chunks;
}

function chunkStandardBlocks(blocks: ExtractedBlock[]): Chunk[] {
  const prepared = prepareBlocks(blocks);
  const chunks: Chunk[] = [];

  for (const block of prepared) {
    const blockChunks = chunkTextSegments(
      [block.content],
      STANDARD_TARGET_CHARS,
      STANDARD_OVERLAP_CHARS,
      {
        ...(block.page !== undefined ? { page: block.page } : {}),
        ...(block.heading ? { heading: block.heading } : {}),
      },
    );
    chunks.push(...blockChunks);
  }

  return chunks;
}

function buildParentPassages(blocks: ExtractedBlock[]) {
  const prepared = prepareBlocks(blocks);
  const parents: Array<{ content: string; metadata: Chunk["metadata"] }> = [];

  for (const block of prepared) {
    const pieces = splitOversized(block.content, PARENT_TARGET_CHARS);
    for (const piece of pieces) {
      const previous = parents.at(-1);
      const metadata = {
        ...(block.page !== undefined ? { page: block.page } : {}),
        ...(block.heading ? { heading: block.heading } : {}),
      };

      if (previous && previous.content.length + 1 + piece.length <= PARENT_TARGET_CHARS) {
        previous.content = `${previous.content}\n\n${piece}`;
        continue;
      }

      parents.push({ content: piece, metadata });
    }
  }

  return parents;
}

function splitParentIntoChildren(
  parent: { content: string; metadata: Chunk["metadata"] },
  parentIndex: number,
): Chunk[] {
  const pieces = splitOversized(parent.content, CHILD_TARGET_CHARS);
  const children: Chunk[] = [];

  for (const piece of pieces) {
    const previous = children.at(-1);
    if (previous && previous.content.length + 1 + piece.length <= CHILD_TARGET_CHARS) {
      previous.content = `${previous.content}\n\n${piece}`;
      continue;
    }

    const overlap =
      previous && CHILD_OVERLAP_CHARS > 0 ? previous.content.slice(-CHILD_OVERLAP_CHARS).trim() : "";
    const content = overlap ? `${overlap}\n${piece}` : piece;
    children.push({
      content: content.slice(0, CHILD_TARGET_CHARS + CHILD_OVERLAP_CHARS),
      metadata: {
        ...parent.metadata,
        parentIndex,
      },
      parentContent: parent.content,
    });
  }

  if (children.length === 0) {
    children.push({
      content: parent.content.slice(0, CHILD_TARGET_CHARS),
      metadata: {
        ...parent.metadata,
        parentIndex,
      },
      parentContent: parent.content,
    });
  }

  return children;
}

export function chunkBlocksParentChild(blocks: ExtractedBlock[]): Chunk[] {
  return buildParentPassages(blocks).flatMap((parent, parentIndex) =>
    splitParentIntoChildren(parent, parentIndex),
  );
}

export function chunkBlocks(blocks: ExtractedBlock[], mode: ChunkingMode = "standard"): Chunk[] {
  if (mode === "parent_child") {
    return chunkBlocksParentChild(blocks);
  }

  return chunkStandardBlocks(blocks);
}
