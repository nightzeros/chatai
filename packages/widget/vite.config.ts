import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/entry.ts",
      formats: ["iife"],
      name: "ChatAIWidget",
      fileName: () => "chat.js",
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
