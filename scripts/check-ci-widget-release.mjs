import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [packageJson, turbo, workflow] = await Promise.all([
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "turbo.json"), "utf8"),
  readFile(path.join(root, ".github/workflows/ci.yml"), "utf8"),
]);

assert.equal(
  JSON.parse(packageJson).scripts.test,
  "turbo run test",
  "Root test script must aggregate package tests through Turbo.",
);
assert.match(turbo, /"test"\s*:\s*\{/);

for (const command of [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm widget:check",
]) {
  assert.match(workflow, new RegExp(command.replace(" ", "\\s+")));
}

assert.match(workflow, /playwright install(?:[^\n]*)chromium/i);
assert.match(workflow, /curl[\s\S]*?\/widget\/chat\.js/i);
assert.match(workflow, /^\s*run:\s*pnpm e2e\s*$/m);

const positions = [
  "pnpm lint",
  "pnpm typecheck",
  "pnpm test",
  "pnpm build",
  "pnpm widget:check",
  "run: pnpm e2e\n",
].map((command) => workflow.indexOf(command));

assert.ok(
  positions.every((position, index) => index === 0 || position > positions[index - 1]),
  "CI release gates must run in lint, typecheck, test, build, widget check, e2e order.",
);

const downloadedAssetCheck = spawnSync(
  process.execPath,
  [
    path.join(root, "scripts/check-widget-asset.mjs"),
    "--",
    path.join(root, "apps/web/public/widget/chat.js"),
  ],
  { encoding: "utf8" },
);
assert.equal(
  downloadedAssetCheck.status,
  0,
  `Widget checker must accept a pnpm-forwarded asset path.\n${downloadedAssetCheck.stderr}`,
);

console.log("[ci] Widget release gates are configured.");
