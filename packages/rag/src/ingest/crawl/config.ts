import type { WebsiteSourceConfig } from "@chatai/database";

export function clampWebsiteConfig(config: WebsiteSourceConfig) {
  const maxPages = Math.min(Math.max(config.maxPages ?? 50, 1), 200);
  const maxDepth = Math.min(Math.max(config.maxDepth ?? 3, 1), 5);
  return { ...config, maxPages, maxDepth };
}
