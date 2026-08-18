import { beforeEach, describe, expect, it, vi } from "vitest";

import { discoverWebsitePages } from "./discover";
import { assertSafeUrl } from "./ssrf";

const publicLookup = async () => [{ address: "93.184.216.34" }];

const origin = "https://docs.example.com";

function createCtx() {
  return { userAgent: "ChatAIBot", fetch: vi.fn() };
}

function mockFetch(ctx: ReturnType<typeof createCtx>, routes: Record<string, string>) {
  ctx.fetch.mockImplementation(async (input: string | URL) => {
    const url = input.toString();
    const body = routes[url];
    if (body === undefined) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  });
}

describe("discoverWebsitePages", () => {
  let ctx: ReturnType<typeof createCtx>;

  beforeEach(() => {
    ctx = createCtx();
  });
  it("prefers sitemap URLs over BFS crawl", async () => {
    mockFetch(ctx, {
      [`${origin}/robots.txt`]: "User-agent: *\nDisallow:",
      [`${origin}/sitemap.xml`]: `
        <urlset>
          <loc>${origin}/guide</loc>
          <loc>${origin}/pricing</loc>
        </urlset>
      `,
    });

    const pages = await discoverWebsitePages(
      { startUrl: `${origin}/`, maxPages: 10 },
      ctx,
      publicLookup,
    );

    expect(pages.map((page) => page.url)).toEqual([`${origin}/guide`, `${origin}/pricing`]);
    expect(ctx.fetch).not.toHaveBeenCalledWith(`${origin}/`, expect.anything());
  });

  it("falls back to same-origin BFS when no sitemap pages are found", async () => {
    mockFetch(ctx, {
      [`${origin}/robots.txt`]: "",
      [`${origin}/sitemap.xml`]: "<urlset></urlset>",
      [`${origin}/`]: `<html><body><a href="/about">About</a></body></html>`,
      [`${origin}/about`]: "<html><body><h1>About</h1></body></html>",
    });

    const pages = await discoverWebsitePages(
      { startUrl: `${origin}/`, maxPages: 5, maxDepth: 2 },
      ctx,
      publicLookup,
    );

    expect(pages.map((page) => page.url)).toEqual([`${origin}/`, `${origin}/about`]);
  });

  it("honors robots.txt disallow rules", async () => {
    mockFetch(ctx, {
      [`${origin}/robots.txt`]: "User-agent: *\nDisallow: /private\nUser-agent: ChatAIBot\nDisallow: /secret",
      [`${origin}/sitemap.xml`]: `
        <urlset>
          <loc>${origin}/public</loc>
          <loc>${origin}/secret</loc>
        </urlset>
      `,
    });

    const pages = await discoverWebsitePages({ startUrl: `${origin}/` }, ctx, publicLookup);
    expect(pages.map((page) => page.url)).toEqual([`${origin}/public`]);
  });

  it("ignores off-origin sitemap entries", async () => {
    mockFetch(ctx, {
      [`${origin}/robots.txt`]: "",
      [`${origin}/sitemap.xml`]: `
        <urlset>
          <loc>${origin}/local</loc>
          <loc>https://other.example.com/remote</loc>
        </urlset>
      `,
    });

    const pages = await discoverWebsitePages({ startUrl: `${origin}/` }, ctx, publicLookup);
    expect(pages.map((page) => page.url)).toEqual([`${origin}/local`]);
  });

  it("respects maxPages caps", async () => {
    mockFetch(ctx, {
      [`${origin}/robots.txt`]: "",
      [`${origin}/sitemap.xml`]: `
        <urlset>
          <loc>${origin}/one</loc>
          <loc>${origin}/two</loc>
          <loc>${origin}/three</loc>
        </urlset>
      `,
    });

    const pages = await discoverWebsitePages(
      { startUrl: `${origin}/`, maxPages: 2 },
      ctx,
      publicLookup,
    );
    expect(pages).toHaveLength(2);
  });

  it("rejects unsafe start URLs before fetching", async () => {
    const isolatedCtx = createCtx();
    await expect(
      discoverWebsitePages({ startUrl: "https://localhost/" }, isolatedCtx, async () => [
        { address: "127.0.0.1" },
      ]),
    ).rejects.toThrow(/restricted hosts/i);
    expect(isolatedCtx.fetch).not.toHaveBeenCalled();
  });
});

describe("assertSafeUrl integration", () => {
  it("normalizes bare hostnames to https", async () => {
    const url = await assertSafeUrl("docs.example.com/start", publicLookup);
    expect(url.toString()).toBe("https://docs.example.com/start");
  });
});
