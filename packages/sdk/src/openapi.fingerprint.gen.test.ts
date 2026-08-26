import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import { getOpenApiDocument } from "./openapi";

const snapshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi.fingerprint.json");

function operationFingerprints(doc: ReturnType<typeof getOpenApiDocument>) {
  const ops: Array<{ method: string; path: string }> = [];
  for (const [route, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        ops.push({ method: method.toUpperCase(), path: route });
      }
    }
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

describe("openapi fingerprint generator", () => {
  it("writes openapi.fingerprint.json when UPDATE_OPENAPI_FINGERPRINT=1", () => {
    if (process.env.UPDATE_OPENAPI_FINGERPRINT !== "1") return;

    const doc = getOpenApiDocument();
    const operations = operationFingerprints(doc);
    const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex");

    writeFileSync(
      snapshotPath,
      `${JSON.stringify({ version: doc.info.version, operations, hash }, null, 2)}\n`,
      "utf8",
    );
  });
});
