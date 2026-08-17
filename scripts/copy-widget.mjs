import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "packages/widget/dist/chat.js");
const destination = path.join(root, "apps/web/public/widget/chat.js");

try {
  await stat(source);
} catch {
  throw new Error("Widget bundle is missing. Run `pnpm --filter @chatai/widget build` before copying it.");
}

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`[widget] Copied ${path.relative(root, source)} to ${path.relative(root, destination)}.`);
