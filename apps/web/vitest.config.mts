import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Inline ChatAI workspace packages so Vitest does not externalize them to Node
 * (which breaks Next `@/` aliases and TypeScript package exports).
 */
export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next; tests that import pages need a JSX transform.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
  test: {
    server: {
      deps: {
        inline: [/@chatai\//],
      },
    },
  },
});
