#!/usr/bin/env node
/* global console, process */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NPM_PUBLIC_PACKAGES } from "./npm-public-packages.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(path.join(root, "VERSION"), "utf8").trim();

function rewriteWorkspaceDeps(manifest) {
  const next = structuredClone(manifest);
  if (next.publishConfig?.provenance !== undefined) {
    delete next.publishConfig.provenance;
    if (Object.keys(next.publishConfig).length === 0) {
      delete next.publishConfig;
    }
  }
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = next[section];
    if (!deps) continue;
    for (const [name, value] of Object.entries(deps)) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        deps[name] = `^${version}`;
      }
    }
  }
  return next;
}

/**
 * Copy a publishable package to `destRoot/<directory>` with workspace deps rewritten.
 */
export function preparePackageManifests(destRoot) {
  mkdirSync(destRoot, { recursive: true });
  const prepared = [];

  for (const pkg of NPM_PUBLIC_PACKAGES) {
    const sourceDir = path.join(root, pkg.directory);
    const targetDir = path.join(destRoot, pkg.directory);
    rmSync(targetDir, { recursive: true, force: true });
    mkdirSync(targetDir, { recursive: true });

    const manifest = JSON.parse(readFileSync(path.join(sourceDir, "package.json"), "utf8"));
    writeFileSync(path.join(targetDir, "package.json"), `${JSON.stringify(rewriteWorkspaceDeps(manifest), null, 2)}\n`);

    cpSync(path.join(sourceDir, "dist"), path.join(targetDir, "dist"), { recursive: true });

    for (const file of ["README.md", "LICENSE"]) {
      const source = path.join(sourceDir, file);
      if (existsSync(source)) {
        cpSync(source, path.join(targetDir, file));
      }
    }

    prepared.push({ ...pkg, targetDir, version: manifest.version });
  }

  return prepared;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dest = process.argv[2] ?? path.join(root, ".npm-publish");
  const prepared = preparePackageManifests(dest);
  for (const pkg of prepared) {
    console.log(`[prepare-package-manifests] ${pkg.name}@${pkg.version} → ${pkg.targetDir}`);
  }
}
