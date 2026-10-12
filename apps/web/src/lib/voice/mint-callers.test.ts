import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SCANNED = ["apps", "packages", "examples", "e2e"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "public"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
/** A request to the mint endpoint itself, not its `/:sessionId/...` sub-routes. */
const MINT_CALL = /\b(fetch|fetcher)\(\s*[`"'][^`"']*\/api\/v1\/voice\/sessions[`"']/;
/** The shared contract: the widget-core capability list, directly or via the Playground builder. */
const CONTRACT = /\bVOICE_CLIENT_CAPABILITIES\b|\bbuildPlaygroundMintBody\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path.join(dir, entry.name));
    if (!SOURCE.test(entry.name) || /\.(test|spec)\./.test(entry.name)) return [];
    return [path.join(dir, entry.name)];
  });
}

describe("Voice mint callers", () => {
  const callers = SCANNED.flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
    .filter((file) => MINT_CALL.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(ROOT, file));

  it("finds the known clients (the scan itself works)", () => {
    expect(callers).toEqual(
      expect.arrayContaining([
        "packages/widget-core/src/voice.ts",
        "apps/web/src/components/playground/voice-panel.tsx",
      ]),
    );
  });

  it("every client that mints declares the shared capabilities, so none is refused for missing playback_gate", () => {
    const missing = callers.filter((file) => !CONTRACT.test(readFileSync(path.join(ROOT, file), "utf8")));
    expect(missing).toEqual([]);
  });
});
