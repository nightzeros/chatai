import { gzipSync } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 30 * 1024;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAsset = path.join(root, "apps/web/public/widget/chat.js");
const assetArgument = process.argv.slice(2).find((argument) => argument !== "--");
const asset = assetArgument ? path.resolve(assetArgument) : defaultAsset;
const displayAsset = assetArgument ?? "apps/web/public/widget/chat.js";

try {
  await stat(asset);
} catch {
  throw new Error(
    `Hosted widget asset missing at ${displayAsset}. Run \`pnpm --filter @chatai/web prebuild\` first.`,
  );
}

const source = await readFile(asset);
const text = source.toString("utf8");
for (const marker of ["ChatAIWidget", "data-assistant-id"]) {
  if (!text.includes(marker)) {
    throw new Error(`Hosted widget asset is missing expected marker: ${marker}`);
  }
}

const compressedSize = gzipSync(source).byteLength;
if (compressedSize > BUDGET_BYTES) {
  throw new Error(
    `Hosted widget asset is ${(compressedSize / 1024).toFixed(1)} kB gzipped; budget is ${BUDGET_BYTES / 1024} kB.`,
  );
}

console.log(
  `[widget] Hosted asset OK (${source.byteLength} bytes, ${(compressedSize / 1024).toFixed(1)} kB gzip, budget ${BUDGET_BYTES / 1024} kB).`,
);
