import type { WebsiteSourceConfig } from "@chatai/database";

import { fetchText } from "../crawl/fetch-text";
import { discoverWebsitePages } from "../crawl/discover";
import { hashExtractedBlocks } from "../hash";
import { extractFromHtml } from "../html-to-markdown";
import type { Loader } from "./types";

export const websiteLoader: Loader<WebsiteSourceConfig> = {
  type: "website",
  async discover(config, ctx) {
    return discoverWebsitePages(config, ctx);
  },
  async extract(item, ctx) {
    if (!item.url) {
      throw new Error("Website pages require a URL.");
    }
    const html = await fetchText(item.url, {
      fetcher: ctx.fetch,
      userAgent: ctx.userAgent,
    });
    const blocks = extractFromHtml(html);
    if (blocks.length === 0) {
      throw new Error("No readable content could be extracted from this page.");
    }
    return { blocks, contentHash: hashExtractedBlocks(blocks) };
  },
};
