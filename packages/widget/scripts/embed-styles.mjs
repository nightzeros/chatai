/* global URL */

import { readFileSync, writeFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const output = `// Generated from styles.css by scripts/embed-styles.mjs.\nconst styles = ${JSON.stringify(css)};\n\nexport default styles;\n`;

writeFileSync(new URL("../src/styles.generated.ts", import.meta.url), output);
