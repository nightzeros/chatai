/* global URL, console */

import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const BUDGET_BYTES = 30 * 1024;
const bundle = readFileSync(new URL("../dist/chat.js", import.meta.url));
const compressedSize = gzipSync(bundle).byteLength;

if (compressedSize > BUDGET_BYTES) {
  throw new Error(
    `Widget bundle is ${(compressedSize / 1024).toFixed(1)} kB gzipped; budget is ${BUDGET_BYTES / 1024} kB.`,
  );
}

console.log(`[widget] ${(compressedSize / 1024).toFixed(1)} kB gzipped (budget: ${BUDGET_BYTES / 1024} kB)`);
