#!/usr/bin/env node
/* global console, process */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";
import { preparePackageManifests } from "./prepare-package-manifests.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();
const dryRun = process.argv.includes("--dry-run");

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

function assertVersionNotPublished(name) {
  try {
    const published = execSync(`npm view ${name}@${version} version`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (published === version) {
      throw new Error(`${name}@${version} is already published on npm`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("already published")) {
      throw error;
    }
  }
}

const preparedRoot = path.join(root, ".npm-publish");
const prepared = preparePackageManifests(preparedRoot);

for (const pkg of prepared) {
  assertVersionNotPublished(pkg.name);
  const publishCmd = dryRun
    ? "npm publish --dry-run --access public --provenance"
    : "npm publish --access public --provenance";
  console.log(`[publish-npm] ${dryRun ? "dry-run" : "publish"} ${pkg.name}@${version}`);
  run(publishCmd, pkg.targetDir);
}

console.log(`[publish-npm] Completed ${dryRun ? "dry-run" : "publish"} for ${prepared.length} packages.`);
