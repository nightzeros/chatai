import { describe, expect, it } from "vitest";

import { isSafeHref, parseMarkdownBlocks } from "./markdown-message";

describe("isSafeHref", () => {
  it("allows http, https, and mailto", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:hi@example.com")).toBe(true);
  });

  it("rejects javascript and relative urls", () => {
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("/local")).toBe(false);
    expect(isSafeHref("ftp://files.example")).toBe(false);
  });
});

describe("parseMarkdownBlocks", () => {
  it("parses markdown links and autolinks bare urls", () => {
    const blocks = parseMarkdownBlocks("See [docs](https://docs.nightzeros.com) and https://app.nightzeros.com.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph") return;
    const types = blocks[0].children.map((t) => t.type);
    expect(types).toContain("link");
    const hrefs = blocks[0].children.filter((t) => t.type === "link").map((t) => (t.type === "link" ? t.href : ""));
    expect(hrefs).toEqual(["https://docs.nightzeros.com", "https://app.nightzeros.com"]);
  });

  it("does not create links for unsafe markdown hrefs", () => {
    const blocks = parseMarkdownBlocks("[x](javascript:alert(1))");
    expect(blocks[0]?.type).toBe("paragraph");
    if (blocks[0]?.type !== "paragraph") return;
    expect(blocks[0].children.every((t) => t.type !== "link")).toBe(true);
  });

  it("parses lists and fenced code", () => {
    const blocks = parseMarkdownBlocks("- one\n- two\n\n```ts\nconst x = 1\n```");
    expect(blocks[0]).toMatchObject({ type: "ul" });
    expect(blocks[1]).toMatchObject({ type: "code", language: "ts", value: "const x = 1" });
  });
});
