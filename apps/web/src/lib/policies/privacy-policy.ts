import type { ConversationSource, PrivacySettings } from "@chatai/database";

import {
  resolvePrivacyPolicy,
  type ResolvedPrivacyPolicy,
} from "./resolve-privacy-policy";

export type PrivacyPolicyAssistant = {
  privacySettings?: PrivacySettings | null;
};

const ANONYMIZE_MAX_DAYS = 30;

export class PrivacyPolicy {
  readonly resolved: ResolvedPrivacyPolicy;

  private constructor(resolved: ResolvedPrivacyPolicy) {
    this.resolved = resolved;
  }

  static fromAssistant(assistant: PrivacyPolicyAssistant): PrivacyPolicy {
    return new PrivacyPolicy(resolvePrivacyPolicy(assistant.privacySettings));
  }

  /**
   * Owner playground always persists. Widget/API respect `storeConversations`.
   */
  shouldPersistConversation(
    source: ConversationSource,
    isOwnerPlayground: boolean,
  ): boolean {
    if (source === "playground" || isOwnerPlayground) {
      return true;
    }
    return this.resolved.storeConversations;
  }

  /** Cutoff for retention purge; `null` when retention is off. */
  retentionCutoff(now = new Date()): Date | null {
    const days = this.resolved.retentionDays;
    if (days === "off") {
      return null;
    }
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  /** Cutoff for visitorId anonymization; `null` when anonymization is disabled. */
  anonymizeCutoff(now = new Date()): Date | null {
    if (!this.resolved.anonymizeVisitorIds) {
      return null;
    }

    let windowDays = ANONYMIZE_MAX_DAYS;
    const retention = this.resolved.retentionDays;
    if (retention !== "off") {
      windowDays = Math.min(ANONYMIZE_MAX_DAYS, retention);
    }

    return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  }

  /**
   * Anonymize when enabled and the conversation is older than
   * min(30 days, retention window). If retention is off, use 30 days.
   */
  shouldAnonymizeVisitor(updatedAt: Date, now = new Date()): boolean {
    const cutoff = this.anonymizeCutoff(now);
    if (!cutoff) {
      return false;
    }
    return updatedAt.getTime() < cutoff.getTime();
  }
}
