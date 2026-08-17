import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WIDGET_ASSET_PATH, widgetAssetHeaders } from "./widget-delivery";

describe("widget delivery headers", () => {
  it("serves the stable widget URL with revalidation instead of immutable caching", () => {
    expect(WIDGET_ASSET_PATH).toBe("/widget/chat.js");
    expect(widgetAssetHeaders).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ]),
    );
  });

  it("keeps a copied public artifact with the IIFE bootstrap markers", () => {
    const assetPath = path.join(process.cwd(), "public/widget/chat.js");
    expect(existsSync(assetPath), "run web prebuild/predev to copy chat.js").toBe(true);

    const source = readFileSync(assetPath, "utf8");
    expect(source).toContain("ChatAIWidget");
    expect(source).toContain("data-assistant-id");
  });
});
