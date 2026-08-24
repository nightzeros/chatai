export type PrivacyRetentionDays = "off" | 7 | 30 | 90;

export type PrivacySettings = {
  /**
   * When false, widget/public API chat streams without persisting conversation rows.
   * Playground always stores.
   */
  storeConversations?: boolean;
  /** off = no automatic purge; 7 | 30 | 90 = days */
  retentionDays?: PrivacyRetentionDays;
  /**
   * When true, clear visitorId on conversations older than min(30d, retention window).
   */
  anonymizeVisitorIds?: boolean;
};

export const defaultPrivacySettings: {
  storeConversations: boolean;
  retentionDays: PrivacyRetentionDays;
  anonymizeVisitorIds: boolean;
} = {
  storeConversations: true,
  retentionDays: 90,
  anonymizeVisitorIds: false,
};
