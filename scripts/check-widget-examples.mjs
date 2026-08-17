import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const hostedHtml = await readFile(path.join(root, "examples/html-widget/index.html"), "utf8");
const selfHostedHtml = await readFile(path.join(root, "examples/html-widget/self-host.html"), "utf8");
const reactApp = await readFile(path.join(root, "examples/react-widget/src/App.tsx"), "utf8");
const reactPackage = await readFile(path.join(root, "examples/react-widget/package.json"), "utf8");

assert.match(hostedHtml, /data-assistant-id/);
assert.match(hostedHtml, /\/widget\/chat\.js/);
assert.match(selfHostedHtml, /data-api-url/);
assert.match(reactApp, /ChatWidget/);
assert.match(reactPackage, /"@chatai\/react": "workspace:\*"/);

console.log("[examples] Widget example fixtures OK.");
