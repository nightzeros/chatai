#!/usr/bin/env node
/* global console, process */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packDir = path.join(os.tmpdir(), "chatai-npm-pack");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

function run(command, cwd) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

function tarballPath(scopedName) {
  const fileName = `${scopedName.slice(1).replace("/", "-")}-${version}.tgz`;
  const fullPath = path.join(packDir, fileName);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing packed tarball for ${scopedName}: ${fullPath}. Run pnpm packages:verify first.`);
  }
  return fullPath;
}

function main() {
  if (!existsSync(packDir)) {
    throw new Error(`Pack directory missing (${packDir}). Run pnpm packages:verify first.`);
  }

  const installRoot = mkdtempSync(path.join(os.tmpdir(), "chatai-npm-install-"));
  writeFileSync(
    path.join(installRoot, "package.json"),
    `${JSON.stringify({ name: "chatai-npm-install-smoke", private: true, type: "module" }, null, 2)}\n`,
  );

  try {
    const tarballs = NPM_PUBLIC_PACKAGES.map((pkg) => JSON.stringify(tarballPath(pkg.name))).join(" ");
    run(`npm install ${tarballs}`, installRoot);

    const reactCheck = `
      import { ChatWidget } from "@nightzeros/chatai-react";
      if (typeof ChatWidget !== "function") throw new Error("ChatWidget export missing");
      console.log("[packages:verify-install] @nightzeros/chatai-react ok");
    `;
    const sdkCheck = `
      import { ChatAI } from "@nightzeros/chatai-sdk";
      if (typeof ChatAI !== "function") throw new Error("ChatAI export missing");
      console.log("[packages:verify-install] @nightzeros/chatai-sdk ok");
    `;

    writeFileSync(path.join(installRoot, "check-react.mjs"), reactCheck);
    writeFileSync(path.join(installRoot, "check-sdk.mjs"), sdkCheck);

    run("node check-react.mjs", installRoot);
    run("node check-sdk.mjs", installRoot);

    const reactTypes = path.join(
      installRoot,
      "node_modules",
      "@nightzeros",
      "chatai-react",
      "dist",
      "index.d.ts",
    );
    const sdkTypes = path.join(installRoot, "node_modules", "@nightzeros", "chatai-sdk", "dist", "index.d.ts");
    if (!existsSync(reactTypes) || !existsSync(sdkTypes)) {
      throw new Error("Installed packages are missing dist/index.d.ts type declarations");
    }

    console.log(`[packages:verify-install] Smoke install ok in ${installRoot}`);
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
