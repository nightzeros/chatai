import { describe, expect, it } from "vitest";

import { ALLOWED_UPLOAD_LABEL, isAllowedUpload } from "./upload-allowlist";

describe("upload allowlist", () => {
  it("accepts CSV, HTML, and JSON in addition to existing document types", () => {
    expect(isAllowedUpload({ name: "plans.csv", type: "text/csv" })).toBe(true);
    expect(isAllowedUpload({ name: "page.html", type: "text/html" })).toBe(true);
    expect(isAllowedUpload({ name: "page.htm", type: "" })).toBe(true);
    expect(isAllowedUpload({ name: "rows.json", type: "application/json" })).toBe(true);
    expect(isAllowedUpload({ name: "policy.pdf", type: "application/pdf" })).toBe(true);
  });

  it("rejects unsupported types", () => {
    expect(isAllowedUpload({ name: "photo.png", type: "image/png" })).toBe(false);
  });

  it("lists the new formats in the user-facing allowlist label", () => {
    expect(ALLOWED_UPLOAD_LABEL).toMatch(/CSV/i);
    expect(ALLOWED_UPLOAD_LABEL).toMatch(/HTML/i);
    expect(ALLOWED_UPLOAD_LABEL).toMatch(/JSON/i);
  });
});
