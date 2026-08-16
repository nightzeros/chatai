import type { Chunk, ExtractedBlock } from "./types";

/** ~4 characters per token is a stable approximation without a tokenizer. */
const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

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

export function chunkBlocks(blocks: ExtractedBlock[]): Chunk[] {
  const prepared = blocks
    .map((block) => ({ ...block, content: block.content.trim() }))
    .filter((block) => block.content.length > 0);

  const chunks: Chunk[] = [];

  for (const block of prepared) {
    const pieces = splitOversized(block.content, TARGET_CHARS);
    for (const piece of pieces) {
      const previous = chunks.at(-1);
      if (previous && previous.content.length + 1 + piece.length <= TARGET_CHARS) {
        previous.content = `${previous.content}\n\n${piece}`;
        continue;
      }

      const overlap =
        previous && OVERLAP_CHARS > 0 ? previous.content.slice(-OVERLAP_CHARS).trim() : "";
      const content = overlap ? `${overlap}\n${piece}` : piece;
      chunks.push({
        content: content.slice(0, TARGET_CHARS + OVERLAP_CHARS),
        metadata: {
          ...(block.page !== undefined ? { page: block.page } : {}),
          ...(block.heading ? { heading: block.heading } : {}),
        },
      });
    }
  }

  return chunks;
}
