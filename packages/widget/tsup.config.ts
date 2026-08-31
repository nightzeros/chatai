import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: false,
  outDir: "dist",
  target: "es2022",
  platform: "browser",
  external: ["@nightzeros/chatai-widget-core", "preact", "preact/hooks"],
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "preact";
  },
});
