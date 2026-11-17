/**
 * Purpose pre-output trigger precedence (plan implementation note 1).
 * Exemptions are evaluated before any substantive-claim clause.
 */

export type PurposeResponseClass = "social_only" | "profile_overview" | "other";

export type PurposePreOutputInput = {
  responseClass: PurposeResponseClass;
  /** Every citation id in the draft (1-based or stable string ids). */
  citationIds: string[];
  /** Profile fact / overview claim ids available in this turn's evidence snapshot. */
  profileEvidenceIds: string[];
  /** Knowledge passage citation ids supplied this turn (searchKnowledge results). */
  knowledgePassageIds: string[];
  searchKnowledgeCalled: boolean;
  requestIsProfileCoveredOverview: boolean;
  earlierCheckPurposeUncertain: boolean;
  draftHasSubstantiveNonSocialClaims: boolean;
};

/**
 * Returns true when the server should run checkPurpose with reason server_pre_output.
 */
export function shouldRunPurposePreOutput(input: PurposePreOutputInput): boolean {
  // 1. Social-only → skip
  if (input.responseClass === "social_only") return false;

  // 2. Clean profile overview → skip (substantive claims do NOT override)
  if (isCleanProfileOverview(input)) return false;

  // 3. Run when any of these hold
  const hasKnowledgeCitation = input.citationIds.some((id) =>
    input.knowledgePassageIds.includes(id),
  );
  if (hasKnowledgeCitation) return true;
  if (input.searchKnowledgeCalled) return true;
  if (input.earlierCheckPurposeUncertain) return true;
  if (input.draftHasSubstantiveNonSocialClaims) return true;

  // Draft not skip-eligible (responseClass other without clean overview)
  if (input.responseClass === "other") return true;

  return false;
}

function isCleanProfileOverview(input: PurposePreOutputInput): boolean {
  if (input.responseClass !== "profile_overview") return false;
  if (input.searchKnowledgeCalled) return false;
  if (!input.requestIsProfileCoveredOverview) return false;
  if (input.citationIds.length === 0) return true;
  return input.citationIds.every((id) => input.profileEvidenceIds.includes(id));
}
