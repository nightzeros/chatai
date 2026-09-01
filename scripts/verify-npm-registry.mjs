#!/usr/bin/env node
/* global console, process */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

const EXPECTED_DEPENDENCIES = {
  "@nightzeros/chatai-widget-core": {},
  "@nightzeros/chatai-widget": {
    "@nightzeros/chatai-widget-core": `^${version}`,
    preact: "^10.27.2",
  },
  "@nightzeros/chatai-react": {
    "@nightzeros/chatai-widget": `^${version}`,
  },
  "@nightzeros/chatai-sdk": {
    zod: "^3.24.2",
    "@asteasolutions/zod-to-openapi": "^7.3.4",
  },
};

function run(command, cwd) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

function runCapture(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function npmView(field, pkg) {
  try {
    return runCapture(`npm view ${pkg} ${field} --json`);
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    throw new Error(`[packages:verify-registry] npm view ${pkg} ${field} failed: ${stderr.trim()}`);
  }
}

function parseJsonField(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.replace(/^"|"$/g, "");
  }
}

function assertRegistryPackage(pkg) {
  const publishedVersion = parseJsonField(npmView("version", pkg.name));
  const latestTag = parseJsonField(npmView("dist-tags.latest", pkg.name));

  if (publishedVersion !== version) {
    throw new Error(
      `[packages:verify-registry] ${pkg.name}: expected version ${version}, got ${publishedVersion}`,
    );
  }
  if (latestTag !== version) {
    throw new Error(
      `[packages:verify-registry] ${pkg.name}: expected latest=${version}, got ${latestTag}`,
    );
  }

  const depsRaw = (() => {
    try {
      return npmView("dependencies", pkg.name);
    } catch {
      return "{}";
    }
  })();
  const deps = depsRaw === "undefined" || depsRaw === "" ? {} : JSON.parse(depsRaw);
  const expected = EXPECTED_DEPENDENCIES[pkg.name] ?? {};

  for (const [depName, depRange] of Object.entries(expected)) {
    if (deps[depName] !== depRange) {
      throw new Error(
        `[packages:verify-registry] ${pkg.name}: expected dependency ${depName}@${depRange}, got ${deps[depName] ?? "(missing)"}`,
      );
    }
  }

  console.log(`[packages:verify-registry] ${pkg.name}@${publishedVersion} ok (latest=${latestTag})`);
}

function assertRegistryInstallSmoke() {
  const installRoot = mkdtempSync(path.join(os.tmpdir(), "chatai-npm-registry-"));

  try {
    writeFileSync(
      path.join(installRoot, "package.json"),
      `${JSON.stringify({ name: "chatai-npm-registry-smoke", private: true, type: "module" }, null, 2)}\n`,
    );

    run(
      `npm install @nightzeros/chatai-react@${version} @nightzeros/chatai-sdk@${version}`,
      installRoot,
    );

    const reactCheck = `
      import { ChatWidget } from "@nightzeros/chatai-react";
      if (typeof ChatWidget !== "function") throw new Error("ChatWidget export missing");
      console.log("[packages:verify-registry] @nightzeros/chatai-react import ok");
    `;
    const sdkCheck = `
      import { ChatAI } from "@nightzeros/chatai-sdk";
      if (typeof ChatAI !== "function") throw new Error("ChatAI export missing");
      console.log("[packages:verify-registry] @nightzeros/chatai-sdk import ok");
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
    const sdkTypes = path.join(
      installRoot,
      "node_modules",
      "@nightzeros",
      "chatai-sdk",
      "dist",
      "index.d.ts",
    );
    if (!existsSync(reactTypes) || !existsSync(sdkTypes)) {
      throw new Error("[packages:verify-registry] Installed packages missing dist/index.d.ts");
    }

    console.log(`[packages:verify-registry] Registry install smoke ok in ${installRoot}`);
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

function main() {
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`[packages:verify-registry] Invalid VERSION: ${version}`);
  }

  for (const pkg of NPM_PUBLIC_PACKAGES) {
    assertRegistryPackage(pkg);
  }

  assertRegistryInstallSmoke();
  console.log(`[packages:verify-registry] All ${NPM_PUBLIC_PACKAGES.length} packages verified on npm`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
