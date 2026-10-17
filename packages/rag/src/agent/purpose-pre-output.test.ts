import { describe, expect, it } from "vitest";

import { shouldRunPurposePreOutput } from "./purpose-pre-output";

describe("shouldRunPurposePreOutput precedence", () => {
  it("skips social_only even with substantive-looking flags", () => {
    expect(
      shouldRunPurposePreOutput({
        responseClass: "social_only",
        citationIds: [],
        profileEvidenceIds: [],
        knowledgePassageIds: [],
        searchKnowledgeCalled: false,
        requestIsProfileCoveredOverview: false,
        earlierCheckPurposeUncertain: false,
        draftHasSubstantiveNonSocialClaims: true,
      }),
    ).toBe(false);
  });

  it("skips clean profile overview even when the draft has substantive claims", () => {
    expect(
      shouldRunPurposePreOutput({
        responseClass: "profile_overview",
        citationIds: ["f1", "f2"],
        profileEvidenceIds: ["f1", "f2"],
        knowledgePassageIds: [],
        searchKnowledgeCalled: false,
        requestIsProfileCoveredOverview: true,
        earlierCheckPurposeUncertain: false,
        draftHasSubstantiveNonSocialClaims: true,
      }),
    ).toBe(false);
  });

  it("runs for cited off-topic drafts with knowledge passages", () => {
    expect(
      shouldRunPurposePreOutput({
        responseClass: "other",
        citationIds: ["1"],
        profileEvidenceIds: ["f1"],
        knowledgePassageIds: ["1"],
        searchKnowledgeCalled: true,
        requestIsProfileCoveredOverview: false,
        earlierCheckPurposeUncertain: false,
        draftHasSubstantiveNonSocialClaims: true,
      }),
    ).toBe(true);
  });

  it("runs when searchKnowledge was called even without citations", () => {
    expect(
      shouldRunPurposePreOutput({
        responseClass: "other",
        citationIds: [],
        profileEvidenceIds: [],
        knowledgePassageIds: ["1"],
        searchKnowledgeCalled: true,
        requestIsProfileCoveredOverview: false,
        earlierCheckPurposeUncertain: false,
        draftHasSubstantiveNonSocialClaims: false,
      }),
    ).toBe(true);
  });

  it("does not let profile overview skip when knowledge passages were used", () => {
    expect(
      shouldRunPurposePreOutput({
        responseClass: "profile_overview",
        citationIds: ["1"],
        profileEvidenceIds: ["f1"],
        knowledgePassageIds: ["1"],
        searchKnowledgeCalled: true,
        requestIsProfileCoveredOverview: true,
        earlierCheckPurposeUncertain: false,
        draftHasSubstantiveNonSocialClaims: true,
      }),
    ).toBe(true);
  });
});
