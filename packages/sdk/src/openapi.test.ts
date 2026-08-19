import { describe, expect, it } from "vitest";

import { getOpenApiDocument } from "./openapi";

describe("getOpenApiDocument", () => {
  const doc = getOpenApiDocument();

  it("is OpenAPI 3.1 from the Zod registry", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("ChatAI API");
  });

  it("documents chat and owner REST paths", () => {
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
      ]),
    );
  });

  it("registers bearer auth", () => {
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
  });
});
