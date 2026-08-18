import { describe, expect, it, vi } from "vitest";

import {
  buildWebsiteSourceConfig,
  createWebsiteSource,
  DUPLICATE_WEBSITE_SOURCE_MESSAGE,
} from "./website-source-create";

vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({
      values: valuesMock,
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: "src-1",
              assistantId: "asst-1",
              type: "website",
              name: "example.com",
              originKey: "https://example.com",
              config: { startUrl: "https://example.com/" },
              status: "pending",
            },
          ],
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "src-1",
}));

const valuesMock = vi.fn();

describe("buildWebsiteSourceConfig", () => {
  it("normalizes equivalent start URLs to the same origin key", () => {
    const first = buildWebsiteSourceConfig({ startUrl: "https://example.com" });
    const second = buildWebsiteSourceConfig({ startUrl: "https://example.com/" });

    expect(first.originKey).toBe("https://example.com");
    expect(second.originKey).toBe("https://example.com");
    expect(first.config.startUrl).toBe("https://example.com/");
    expect(second.config.startUrl).toBe("https://example.com/");
  });
});

describe("createWebsiteSource", () => {
  it("maps unique-index violations to a duplicate website error", async () => {
    valuesMock.mockRejectedValueOnce({ code: "23505" });

    await expect(
      createWebsiteSource({ assistantId: "asst-1", startUrl: "https://example.com/" }),
    ).rejects.toThrow(DUPLICATE_WEBSITE_SOURCE_MESSAGE);
  });

  it("creates a source when the origin key is new", async () => {
    valuesMock.mockResolvedValueOnce(undefined);

    const source = await createWebsiteSource({
      assistantId: "asst-1",
      startUrl: "https://docs.example.com",
    });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originKey: "https://docs.example.com",
        config: expect.objectContaining({ startUrl: "https://docs.example.com/" }),
      }),
    );
    expect(source.id).toBe("src-1");
  });
});
