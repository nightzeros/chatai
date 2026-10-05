import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getOpenApiDocument } from "./openapi";
import { API_VERSION } from "./version";

const snapshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi.fingerprint.json");

type OperationFingerprint = { method: string; path: string };

function operationFingerprints(doc: ReturnType<typeof getOpenApiDocument>): OperationFingerprint[] {
  const ops: OperationFingerprint[] = [];
  for (const [route, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(methods as Record<string, unknown>)) {
      if (["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) {
        ops.push({ method: method.toUpperCase(), path: route });
      }
    }
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function fingerprintHash(ops: OperationFingerprint[]) {
  return createHash("sha256").update(JSON.stringify(ops)).digest("hex");
}

describe("getOpenApiDocument", () => {
  const doc = getOpenApiDocument();

  it("is OpenAPI 3.1 from the Zod registry", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("ChatAI API");
    expect(doc.info.version).toBe(API_VERSION);
  });

  it("documents chat, owner REST, and widget paths", () => {
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/chat",
        "/api/v1/assistants",
        "/api/v1/assistants/{assistantId}",
        "/api/v1/assistants/{assistantId}/documents",
        "/api/v1/assistants/{assistantId}/documents/{documentId}",
        "/api/v1/assistants/{assistantId}/documents/{documentId}/reprocess",
        "/api/v1/assistants/{assistantId}/conversations",
        "/api/v1/assistants/{assistantId}/conversations/{conversationId}",
        "/api/v1/assistants/{assistantId}/analytics",
        "/api/v1/assistants/{publicId}/config",
        "/api/v1/feedback",
        "/api/v1/widget/sign",
      ]),
    );
  });

  it("documents Voice usage refusals and endReason additively", () => {
    const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
    const mint = paths["/api/v1/voice/sessions"]?.post as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    expect(Object.keys(mint.responses)).toEqual(expect.arrayContaining(["402", "429"]));
    const refusal = JSON.stringify(mint.responses["402"]?.content["application/json"]?.schema);
    expect(refusal).toContain("voice_minutes_exhausted");
    expect(refusal).toContain("voice_concurrency_limit");

    const end = paths["/api/v1/voice/sessions/{sessionId}/end"]?.post as {
      responses: Record<string, { content: Record<string, { schema: { required?: string[]; properties?: Record<string, unknown> } }> }>;
    };
    const endSchema = end.responses["200"]?.content["application/json"]?.schema;
    expect(endSchema?.properties).toHaveProperty("endReason");
    expect(endSchema?.required ?? []).not.toContain("endReason");
    expect(JSON.stringify(endSchema?.properties?.endReason)).toContain("voice_unavailable");

    const widgetRefusal = JSON.stringify(mint.responses["403"]?.content["application/json"]?.schema);
    expect(widgetRefusal).toContain("voice_unavailable");
  });

  it("documents the Voice control heartbeat additively", () => {
    const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
    const heartbeat = paths["/api/v1/voice/sessions/{sessionId}/heartbeat"]?.post as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    expect(Object.keys(heartbeat.responses)).toEqual(expect.arrayContaining(["200", "404", "421", "429"]));
    expect(JSON.stringify(heartbeat.responses["200"]?.content["application/json"]?.schema)).toContain("degraded");

    const mint = paths["/api/v1/voice/sessions"]?.post as {
      requestBody: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> };
      responses: Record<string, { content: Record<string, { schema: { required?: string[]; properties?: Record<string, unknown> } }> }>;
    };
    expect(mint.requestBody.content["application/json"]?.schema.properties).toHaveProperty("capabilities");
    const created = mint.responses["200"]?.content["application/json"]?.schema;
    expect(created?.properties).toHaveProperty("controlToken");
    expect(created?.required ?? []).not.toContain("controlToken");
  });

  it("registers bearer auth", () => {
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
  });

  it("matches the frozen operation fingerprint (API contract freeze)", () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      version: string;
      operations: OperationFingerprint[];
      hash: string;
    };
    const operations = operationFingerprints(doc);

    expect(doc.info.version).toBe(snapshot.version);
    expect(operations).toEqual(snapshot.operations);
    expect(fingerprintHash(operations)).toBe(snapshot.hash);
  });
});
