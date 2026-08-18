import { describe, expect, it } from "vitest";

import { assistantCreateSchema, assistantPatchSchema, normalizeAssistantWrite } from "./rest-assistants";

describe("assistantCreateSchema", () => {
  it("requires a name", () => {
    expect(assistantCreateSchema.safeParse({}).success).toBe(false);
    expect(assistantCreateSchema.parse({ name: "Support" }).name).toBe("Support");
  });
});

describe("assistantPatchSchema", () => {
  it("rejects an empty patch", () => {
    expect(assistantPatchSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a partial update", () => {
    expect(assistantPatchSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
});

describe("normalizeAssistantWrite", () => {
  it("turns blank description into null", () => {
    expect(normalizeAssistantWrite({ description: "  " })).toEqual({ description: null });
  });
});
