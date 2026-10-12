/* global URL, process */

import { readFileSync, renameSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const output = `// Generated from styles.css by scripts/embed-styles.mjs.\nconst styles = ${JSON.stringify(css)};\n\nexport default styles;\n`;

const target = new URL("../src/styles.generated.ts", import.meta.url);

let current = null;
try {
  current = readFileSync(target, "utf8");
} catch {
  current = null;
}

// Typecheck can read this file while a build regenerates it, so never leave it truncated.
if (current !== output) {
  const temp = new URL(`../src/styles.generated.ts.${process.pid}.tmp`, import.meta.url);
  writeFileSync(temp, output);
  renameSync(temp, target);
}
