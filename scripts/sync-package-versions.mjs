#!/usr/bin/env node
/* global console, process */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[sync-package-versions] Invalid VERSION: ${version}`);
  process.exit(1);
}

const mismatches = [];

for (const pkg of NPM_PUBLIC_PACKAGES) {
  const manifestPath = path.join(root, pkg.directory, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (checkOnly) {
    if (manifest.version !== version) {
      mismatches.push(`${pkg.name}: package.json=${manifest.version}, VERSION=${version}`);
    }
    continue;
  }

  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[sync-package-versions] ${pkg.name} → ${version}`);
}

if (checkOnly) {
  if (mismatches.length > 0) {
    console.error(`[sync-package-versions] Version mismatch:\n${mismatches.join("\n")}`);
    process.exit(1);
  }
  console.log(`[sync-package-versions] All ${NPM_PUBLIC_PACKAGES.length} packages match VERSION ${version}`);
}
