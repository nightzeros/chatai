import { describe, expect, it, vi } from "vitest";

import type { AssistantOverview, KeyFact } from "@chatai/database";

import { overviewFromEditedClaims, parseOverviewClaims, suggestOverview } from "./overview-generate";

const chat = { apiKey: "test", baseURL: "https://example.com/v1", model: "test" };

const facts: KeyFact[] = [
  {
    id: "f1",
    text: "Ada builds booking products for clinics.",
    topic: "work",
    origin: "owner",
    sources: [{ documentId: "doc-1", contentHash: "h1", quote: "booking" }],
    createdAt: "2026-01-01",
  },
  {
    id: "f2",
    text: "She previously led engineering at a health startup.",
    topic: "background",
    origin: "owner",
    sources: [{ documentId: "doc-1", contentHash: "h1", quote: "engineering" }],
    createdAt: "2026-01-01",
  },
];

describe("parseOverviewClaims", () => {
  it("keeps only claims with real fact ids and enough text", () => {
    const claims = parseOverviewClaims(
      JSON.stringify({
        claims: [
          { text: "Ada builds booking products for clinics.", factIds: ["f1"] },
          { text: "short", factIds: ["f1"] },
          { text: "Invented claim with no backing.", factIds: ["missing"] },
          { text: "Ada led engineering and builds booking tools.", factIds: ["f1", "f2", "missing"] },
        ],
      }),
      facts,
    );
    expect(claims).toHaveLength(2);
    expect(claims[0]?.factIds).toEqual(["f1"]);
    expect(claims[1]?.factIds).toEqual(["f1", "f2"]);
    expect(claims[0]?.sources).toHaveLength(1);
  });
});

describe("overviewFromEditedClaims", () => {
  it("builds a suggestion from owner edits", () => {
    const prior: AssistantOverview = {
      status: "approved",
      version: 2,
      claims: [],
      approvedAt: "2026-01-01",
      approvedBy: "user-1",
    };
    const next = overviewFromEditedClaims(
      [{ id: "c1", text: "Ada builds booking products for clinics.", factIds: ["f1"] }],
      facts,
      prior,
      "2026-02-01",
    );
    expect("error" in next).toBe(false);
    if ("error" in next) return;
    expect(next.status).toBe("suggestion");
    expect(next.version).toBe(3);
    expect(next.approvedAt).toBeNull();
    expect(next.claims[0]?.id).toBe("c1");
  });

  it("rejects claims without supporting facts", () => {
    const next = overviewFromEditedClaims(
      [{ text: "Ada builds booking products for clinics.", factIds: [] }],
      facts,
      null,
      "2026-02-01",
    );
    expect(next).toEqual({ error: "Each overview claim must reference at least one published key fact." });
  });
});

describe("suggestOverview", () => {
  it("returns a suggestion overview from model JSON", async () => {
    const result = await suggestOverview({
      facts,
      represents: "Ada",
      chat,
      generate: vi.fn(async () =>
        JSON.stringify({
          claims: [{ text: "Ada builds booking products for clinics.", factIds: ["f1"] }],
        }),
      ),
      now: "2026-02-01T00:00:00.000Z",
    });
    expect(result.overview?.status).toBe("suggestion");
    expect(result.overview?.claims).toHaveLength(1);
    expect(result.usages[0]?.step).toBe("profile_overview");
  });

  it("returns null when the model invents unsupported claims", async () => {
    const result = await suggestOverview({
      facts,
      represents: null,
      chat,
      generate: vi.fn(async () =>
        JSON.stringify({
          claims: [{ text: "Ada is a world-famous astronaut.", factIds: ["missing"] }],
        }),
      ),
      now: "2026-02-01T00:00:00.000Z",
    });
    expect(result.overview).toBeNull();
  });
});
