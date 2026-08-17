import { createHash } from "node:crypto";

import { cleanContent } from "./clean";
import type { ExtractedBlock } from "./types";

export function hashExtractedBlocks(blocks: ExtractedBlock[]): string {
  const normalized = blocks
    .map((block) => cleanContent(block.content))
    .filter((content) => content.length > 0)
    .join("\n\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function shouldSkipReembed(opts: {
  storedHash: string | null | undefined;
  nextHash: string;
  chunkCount: number;
  force?: boolean;
}) {
  if (opts.force) return false;
  if (!opts.storedHash || opts.chunkCount <= 0) return false;
  return opts.storedHash === opts.nextHash;
}
