import { describe, expect, it } from "vitest";

import type { AssistantOverview, KeyFact } from "@chatai/database";

import {
  activeOverviewClaims,
  factsSupportOverview,
  invalidateOverviewForDocuments,
  invalidateOverviewForFacts,
  isOverviewOrIdentityRequest,
} from "./overview";

const docs = new Map([
  ["doc-1", { id: "doc-1", status: "ready", excluded: false, contentHash: "h1" }],
]);

const approved: AssistantOverview = {
  status: "approved",
  version: 1,
  claims: [
    {
      id: "c1",
      text: "Ada builds booking products.",
      factIds: ["f1", "f2"],
      sources: [{ documentId: "doc-1", contentHash: "h1", quote: "booking" }],
    },
  ],
  approvedAt: "2026-01-01",
};

describe("activeOverviewClaims", () => {
  it("serves approved claims backed by active facts and current documents", () => {
    const active = activeOverviewClaims(approved, new Set(["f1", "f2"]), docs);
    expect(active).toHaveLength(1);
    expect(active[0]?.citationId).toBe("o1");
  });

  it("hides suggestions and invalidated overviews", () => {
    expect(activeOverviewClaims({ ...approved, status: "suggestion" }, new Set(["f1", "f2"]), docs)).toEqual([]);
    expect(activeOverviewClaims({ ...approved, status: "invalidated" }, new Set(["f1", "f2"]), docs)).toEqual([]);
  });

  it("hides claims when a supporting fact is gone", () => {
    expect(activeOverviewClaims(approved, new Set(["f1"]), docs)).toEqual([]);
  });
});

describe("invalidateOverviewForDocuments", () => {
  it("invalidates approved overviews when a source document changes", () => {
    const next = invalidateOverviewForDocuments(approved, new Set(["doc-1"]));
    expect(next?.status).toBe("invalidated");
    expect(next?.version).toBe(2);
  });
});

describe("invalidateOverviewForFacts", () => {
  it("invalidates when a referenced fact is removed", () => {
    const next = invalidateOverviewForFacts(approved, new Set(["f1"]));
    expect(next?.status).toBe("invalidated");
  });
});

describe("overview request helpers", () => {
  it("detects overview phrasing", () => {
    expect(isOverviewOrIdentityRequest("Tell me about him")).toBe(true);
    expect(isOverviewOrIdentityRequest("help me cook")).toBe(false);
  });

  it("allows structured facts to support an overview before narrative approval", () => {
    const facts = [
      { id: "f1" },
      { id: "f2" },
    ] as KeyFact[];
    expect(factsSupportOverview(facts)).toBe(true);
    expect(factsSupportOverview([{ id: "f1" } as KeyFact])).toBe(false);
  });
});
