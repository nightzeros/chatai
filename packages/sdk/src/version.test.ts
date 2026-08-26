import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { API_VERSION } from "./version";

describe("API_VERSION", () => {
  it("matches the repository VERSION file", () => {
    const rootVersion = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../VERSION"),
      "utf8",
    ).trim();
    expect(API_VERSION).toBe(rootVersion);
  });
});
