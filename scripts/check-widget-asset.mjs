import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const source = await readFile(asset, "utf8");
for (const marker of ["ChatAIWidget", "data-assistant-id"]) {
  if (!source.includes(marker)) {
    throw new Error(`Hosted widget asset is missing expected marker: ${marker}`);
  }
}

console.log(`[widget] Hosted asset OK (${source.length} bytes).`);
