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
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const publish = args.includes("--publish");

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

function runCapture(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function assertMode() {
  if (dryRun === publish) {
    console.error("[publish-npm] Specify exactly one mode: --dry-run or --publish");
    process.exit(1);
  }
}

function assertVersionFormat() {
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`[publish-npm] Invalid VERSION: ${version}`);
  }
}

function assertPackageVersionsMatch() {
  const mismatches = [];
  for (const pkg of NPM_PUBLIC_PACKAGES) {
    const manifestPath = path.join(root, pkg.directory, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.version !== version) {
      mismatches.push(`${pkg.name}: package.json=${manifest.version}, VERSION=${version}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `[publish-npm] Package version mismatch (run pnpm packages:sync-versions):\n${mismatches.join("\n")}`,
    );
  }
}

function assertTagMatchesVersion() {
  const refName = process.env.GITHUB_REF_NAME?.trim();
  if (!refName?.startsWith("v")) return;
  const tagVersion = refName.slice(1);
  if (tagVersion !== version) {
    throw new Error(
      `[publish-npm] Tag ${refName} does not match VERSION (${version}). Bump VERSION or retag.`,
    );
  }
}

function assertLocalPublishAllowed() {
  if (publish && process.env.GITHUB_ACTIONS !== "true" && process.env.ALLOW_LOCAL_NPM_PUBLISH !== "1") {
    throw new Error(
      "[publish-npm] Real publish is blocked outside GitHub Actions. Set ALLOW_LOCAL_NPM_PUBLISH=1 only for emergency local use.",
    );
  }
}

function npmViewVersion(name) {
  try {
    return runCapture(`npm view ${name}@${version} version`).trim();
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    const stdout = error instanceof Error && "stdout" in error ? String(error.stdout) : "";
    const combined = `${stdout}\n${stderr}`;
    if (/E404|404 Not Found|Not found|is not in this registry/i.test(combined)) {
      return null;
    }
    throw new Error(`[publish-npm] Failed to query npm for ${name}@${version}: ${combined.trim()}`);
  }
}

function assertVersionsNotPublished() {
  const alreadyPublished = [];
  for (const pkg of NPM_PUBLIC_PACKAGES) {
    const published = npmViewVersion(pkg.name);
    if (published === version) {
      alreadyPublished.push(`${pkg.name}@${version}`);
    }
  }
  if (alreadyPublished.length > 0) {
    throw new Error(
      `[publish-npm] Cannot publish — version already exists on npm:\n${alreadyPublished.map((p) => `  - ${p}`).join("\n")}\nBump VERSION before releasing.`,
    );
  }
}

function buildPublishCommand() {
  const parts = ["npm", "publish", "--access", "public"];
  if (dryRun) {
    parts.push("--dry-run");
  } else if (process.env.GITHUB_ACTIONS === "true") {
    parts.push("--provenance");
  }
  return parts.join(" ");
}

assertMode();
assertVersionFormat();
assertPackageVersionsMatch();
assertTagMatchesVersion();
assertLocalPublishAllowed();
if (publish) {
  assertVersionsNotPublished();
}

const preparedRoot = path.join(root, ".npm-publish");
const prepared = preparePackageManifests(preparedRoot);
const publishCmd = buildPublishCommand();

for (const pkg of prepared) {
  console.log(`[publish-npm] ${dryRun ? "dry-run" : "publish"} ${pkg.name}@${version}`);
  run(publishCmd, pkg.targetDir);
}

console.log(`[publish-npm] Completed ${dryRun ? "dry-run" : "publish"} for ${prepared.length} packages.`);
