import robotsParser from "robots-parser";
import { parseHTML } from "linkedom";

import type { HostLookup } from "./ssrf";
import { assertSafeUrl } from "./ssrf";
import { fetchText } from "./fetch-text";
import { parseSitemapLocs } from "./sitemap";
import {
  isBinaryPath,
  normalizeUrl,
  normalizeUrlString,
  pageNameFromUrl,
  sameOrigin,
} from "./url";
import type { SourceItem } from "../loaders/types";
import type { LoaderContext } from "../loaders/types";
import type { WebsiteSourceConfig } from "@chatai/database";
import { clampWebsiteConfig } from "./config";

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

function extractLinks(html: string, base: URL) {
  const { document } = parseHTML(html);
  const links: string[] = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      continue;
    }
    try {
      const url = normalizeUrl(new URL(href, base).toString());
      if (!sameOrigin(base, url) || isBinaryPath(url)) continue;
      links.push(normalizeUrlString(url.toString()));
    } catch {
      continue;
    }
  }
  return links;
}

function toSourceItems(urls: string[]): SourceItem[] {
  return urls.map((url) => {
    const parsed = normalizeUrl(url);
    return {
      key: url,
      name: pageNameFromUrl(parsed),
      url,
    };
  });
}

async function loadRobots(origin: URL, ctx: LoaderContext) {
  const robotsUrl = `${origin.origin}/robots.txt`;
  try {
    const body = await fetchText(robotsUrl, {
      fetcher: ctx.fetch,
      userAgent: ctx.userAgent,
    });
    return robotsParser(robotsUrl, body);
  } catch {
    return robotsParser(robotsUrl, "");
  }
}

async function discoverFromSitemap(
  origin: URL,
  robots: ReturnType<typeof robotsParser>,
  config: WebsiteSourceConfig,
  ctx: LoaderContext,
) {
  const sitemapCandidates = [
    ...robots.getSitemaps(),
    `${origin.origin}/sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapCandidates) {
    try {
      const sitemapOrigin = normalizeUrl(sitemapUrl);
      if (!sameOrigin(origin, sitemapOrigin)) continue;
      const xml = await fetchText(sitemapUrl, {
        fetcher: ctx.fetch,
        userAgent: ctx.userAgent,
      });
      const pages = parseSitemapLocs(xml, origin, config.maxPages ?? 50).filter((url) =>
        robots.isAllowed(url, ctx.userAgent),
      );
      if (pages.length > 0) {
        return toSourceItems(pages);
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function discoverWithBfs(
  start: URL,
  robots: ReturnType<typeof robotsParser>,
  config: WebsiteSourceConfig,
  ctx: LoaderContext,
) {
  const maxPages = config.maxPages ?? 50;
  const maxDepth = config.maxDepth ?? 3;
  const startUrl = normalizeUrlString(start.toString());
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const seen = new Set<string>();
  const pages: string[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const batch = queue.splice(0, 2);
    const htmlPages = await mapWithConcurrency(batch, 2, async (entry) => {
      if (seen.has(entry.url) || !robots.isAllowed(entry.url, ctx.userAgent)) {
        return { entry, html: null as string | null };
      }
      seen.add(entry.url);
      try {
        const html = await fetchText(entry.url, {
          fetcher: ctx.fetch,
          userAgent: ctx.userAgent,
        });
        return { entry, html };
      } catch {
        return { entry, html: null };
      }
    });

    for (const result of htmlPages) {
      if (pages.length >= maxPages) break;
      if (!result.html) continue;
      if (!pages.includes(result.entry.url)) {
        pages.push(result.entry.url);
      }
      if (result.entry.depth >= maxDepth) continue;
      const pageUrl = normalizeUrl(result.entry.url);
      for (const link of extractLinks(result.html, pageUrl)) {
        if (seen.has(link) || pages.length + queue.length >= maxPages) continue;
        if (!robots.isAllowed(link, ctx.userAgent)) continue;
        queue.push({ url: link, depth: result.entry.depth + 1 });
      }
    }
  }

  return toSourceItems(pages.slice(0, maxPages));
}

export async function discoverWebsitePages(
  config: WebsiteSourceConfig,
  ctx: LoaderContext,
  lookup?: HostLookup,
) {
  const normalizedConfig = clampWebsiteConfig(config);
  const start = await assertSafeUrl(normalizedConfig.startUrl, lookup);
  const robots = await loadRobots(start, ctx);
  const sitemapPages = await discoverFromSitemap(start, robots, normalizedConfig, ctx);
  if (sitemapPages && sitemapPages.length > 0) {
    return sitemapPages;
  }
  return discoverWithBfs(start, robots, normalizedConfig, ctx);
}
