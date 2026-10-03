import { describe, expect, it } from "vitest";

import type { Database, KeyFact } from "@chatai/database";

import { activeFacts, EMPTY_ASSISTANT_CONTEXT, keyFactChunks, loadAssistantContext } from "./profile";
import { isBasicProfileQuestion } from "./profile-answer";

const doc = (overrides: Partial<{ id: string; name: string; status: string; excluded: boolean; contentHash: string | null }> = {}) => ({
  id: "doc-1",
  name: "About%20us.pdf",
  status: "ready",
  excluded: false,
  contentHash: "h1",
  ...overrides,
});

const fact = (overrides: Partial<KeyFact> = {}): KeyFact => ({
  id: "f1",
  text: "The clinic is open Monday to Friday, 8am to 6pm.",
  topic: "hours",
  origin: "generated",
  sources: [{ documentId: "doc-1", contentHash: "h1", quote: "Open Monday to Friday, 8am to 6pm" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("activeFacts (serve-time stale hiding)", () => {
  it("serves a fact whose source is ready, included and unchanged", () => {
    const [active] = activeFacts([fact()], new Map([["doc-1", doc()]]));
    expect(active).toMatchObject({ id: "f1", documentId: "doc-1", documentName: "About us.pdf" });
  });

  it.each([
    ["deleted", new Map()],
    ["excluded", new Map([["doc-1", doc({ excluded: true })]])],
    ["not ready", new Map([["doc-1", doc({ status: "processing" })]])],
    ["changed", new Map([["doc-1", doc({ contentHash: "h2" })]])],
  ])("hides a fact whose source was %s", (_label, docs) => {
    expect(activeFacts([fact()], docs as Map<string, ReturnType<typeof doc>>)).toEqual([]);
  });

  it("owner facts without sources are always served; generated facts without sources never are", () => {
    const active = activeFacts(
      [fact({ id: "o1", origin: "owner", sources: [] }), fact({ id: "g1", origin: "generated", sources: [] })],
      new Map(),
    );
    expect(active.map((item) => item.id)).toEqual(["o1"]);
    expect(active[0]).toMatchObject({ documentId: "key-facts", documentName: "Key facts" });
  });

  it("key facts become background sources marked keyFact", () => {
    const [chunk] = keyFactChunks(activeFacts([fact()], new Map([["doc-1", doc()]])));
    expect(chunk).toMatchObject({ chunkId: "fact:f1", keyFact: true, similarity: 0 });
  });
});

describe("loadAssistantContext", () => {
  it("fails safe to an empty profile (e.g. before migration 0020)", async () => {
    const db = {
      select: () => {
        throw new Error('relation "assistant_profiles" does not exist');
      },
    } as unknown as Database;
    await expect(loadAssistantContext(db, `missing-${Date.now()}`)).resolves.toEqual(EMPTY_ASSISTANT_CONTEXT);
  });
});

describe("isBasicProfileQuestion", () => {
  it.each([
    "Who are you?",
    "What's your email?",
    "How can I contact you?",
    "Where are you located?",
    "What are your opening hours?",
    "When are you open?",
    "Do you have a LinkedIn?",
  ])("recognizes %j", (message) => {
    expect(isBasicProfileQuestion(message)).toBe(true);
  });

  it.each([
    "Can you compare your two newest projects and explain the tradeoffs in detail?",
    "How do I cook rice?",
    "What does the Pro plan include?",
    "Where are you located, and is there parking?",
    "What's your phone number? Do you take walk-ins?",
    "What's your email and do you offer refunds",
  ])("leaves %j to retrieval", (message) => {
    expect(isBasicProfileQuestion(message)).toBe(false);
  });
});
