import { normalizeUrl, normalizeUrlString, sameOrigin } from "./url";

export function parseSitemapLocs(xml: string, origin: URL, maxPages: number) {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  const pages: string[] = [];
  const seen = new Set<string>();

  for (const loc of locs) {
    try {
      const url = normalizeUrl(loc);
      if (!sameOrigin(origin, url)) continue;
      const normalized = normalizeUrlString(url.toString());
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      pages.push(normalized);
      if (pages.length >= maxPages) break;
    } catch {
      continue;
    }
  }

  return pages;
}
