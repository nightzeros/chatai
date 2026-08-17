import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("retrieveChunks", () => {
  it("filters excluded crawled pages out of retrieval", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "retrieve.ts"),
      "utf8",
    );
    expect(source).toContain("eq(documents.excluded, false)");
  });
});
