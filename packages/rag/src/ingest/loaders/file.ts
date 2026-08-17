import { extractFromFile } from "../extract";
import { hashExtractedBlocks } from "../hash";
import type { Loader } from "./types";

export const fileLoader: Loader<{
  name: string;
  mimeType?: string | null;
  storagePath?: string | null;
}> = {
  type: "file",
  async discover(config) {
    return [
      {
        key: config.storagePath ?? config.name,
        name: config.name,
        mimeType: config.mimeType,
        storagePath: config.storagePath,
      },
    ];
  },
  async extract(item) {
    const blocks = await extractFromFile({
      storagePath: item.storagePath ?? "",
      mimeType: item.mimeType,
      name: item.name,
    });
    return { blocks, contentHash: hashExtractedBlocks(blocks) };
  },
};
