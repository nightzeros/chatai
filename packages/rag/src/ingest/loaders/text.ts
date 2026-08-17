import { extractFromText } from "../extract";
import { hashExtractedBlocks } from "../hash";
import type { Loader } from "./types";

function createInlineLoader(type: "text" | "faq"): Loader<{ name: string; content?: string | null }> {
  return {
    type,
    async discover(config) {
      return [{ key: config.name, name: config.name, content: config.content }];
    },
    async extract(item) {
      const blocks = extractFromText(item.content ?? "");
      return { blocks, contentHash: hashExtractedBlocks(blocks) };
    },
  };
}

export const textLoader = createInlineLoader("text");
export const faqLoader = createInlineLoader("faq");
