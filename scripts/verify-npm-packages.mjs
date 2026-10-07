#!/usr/bin/env node
/* global console, process */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEGACY_PUBLISH_PACKAGE_NAMES, NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDir = path.join(os.tmpdir(), "chatai-npm-pack");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

function run(command) {
  execSync(command, { cwd: root, stdio: "inherit", env: process.env });
}

function runCapture(command) {
  return execSync(command, { cwd: root, encoding: "utf8" }).trim();
}

function listTarEntries(tarballPath) {
  return runCapture(`tar -tzf ${JSON.stringify(tarballPath)}`).split("\n").filter(Boolean);
}

function assertNoForbiddenPaths(entries) {
  const forbidden = entries.filter(
    (entry) =>
      entry.includes("/src/") ||
      entry.endsWith(".env") ||
      entry.includes("/.env") ||
      entry.includes("apps/web") ||
      entry.includes("packages/database"),
  );
  if (forbidden.length > 0) {
    throw new Error(`Tarball contains forbidden paths:\n${forbidden.join("\n")}`);
  }
}

function extractManifest(entries, tarballPath) {
  const manifestPath = entries.find((entry) => entry.endsWith("/package.json"));
  if (!manifestPath) {
    throw new Error(`Tarball missing package.json: ${tarballPath}`);
  }
  const raw = runCapture(`tar -xOzf ${JSON.stringify(tarballPath)} ${JSON.stringify(manifestPath)}`);
  return JSON.parse(raw);
}

function tarballFileName(scopedName, version) {
  return `${scopedName.slice(1).replace("/", "-")}-${version}.tgz`;
}

function findTarball(scopedName, version) {
  const expected = tarballFileName(scopedName, version);
  const fullPath = path.join(packDir, expected);
  if (!existsSync(fullPath)) {
    throw new Error(`No tarball found for ${scopedName}: expected ${fullPath}`);
  }
  return fullPath;
}

function assertNoLegacyPublishNames(tarballPath, entries, pkg) {
  for (const entry of entries) {
    const content = runCapture(`tar -xOzf ${JSON.stringify(tarballPath)} ${JSON.stringify(entry)}`);
    for (const legacyName of LEGACY_PUBLISH_PACKAGE_NAMES) {
      if (content.includes(legacyName)) {
        throw new Error(`${pkg.name}: tarball entry ${entry} still references legacy publish name ${legacyName}`);
      }
    }
  }
}

function verifyTarball(tarballPath, pkg) {
  const entries = listTarEntries(tarballPath);
  assertNoForbiddenPaths(entries);

  const hasIndexJs = entries.some((entry) => entry.endsWith("/dist/index.js"));
  const hasIndexDts = entries.some((entry) => entry.endsWith("/dist/index.d.ts"));
  if (!hasIndexJs || !hasIndexDts) {
    throw new Error(`${pkg.name}: tarball missing dist/index.js or dist/index.d.ts`);
  }

  for (const file of ["README.md", "LICENSE"]) {
    if (!entries.some((entry) => entry === `package/${file}`)) {
      throw new Error(`${pkg.name}: tarball missing ${file}`);
    }
  }

  if (pkg.name === "@nightzeros/chatai-widget") {
    const hasChatJs = entries.some((entry) => entry.endsWith("/dist/chat.js"));
    if (hasChatJs) {
      throw new Error(`${pkg.name}: dist/chat.js must not be included in npm tarball`);
    }
  }

  const manifest = extractManifest(entries, tarballPath);
  if (JSON.stringify(manifest).includes("workspace:")) {
    throw new Error(`${pkg.name}: packed package.json still contains workspace: references`);
  }

  assertNoLegacyPublishNames(tarballPath, entries, pkg);

  const sizeKb = Math.round(statSync(tarballPath).size / 1024);
  console.log(`[packages:verify] ${pkg.name} ok (${sizeKb} KiB) → ${tarballPath}`);
}

function main() {
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });

  run("node scripts/sync-package-versions.mjs");

  for (const pkg of NPM_PUBLIC_PACKAGES) {
    run(`pnpm --filter ${pkg.name} build`);
    run(`pnpm pack --pack-destination ${JSON.stringify(packDir)} --filter ${pkg.name}`);
    verifyTarball(findTarball(pkg.name, version), pkg);
  }

  console.log(`[packages:verify] All ${NPM_PUBLIC_PACKAGES.length} packages verified in ${packDir}`);
}

main();
