/**
 * Lists storage keys that must be deleted from object storage before
 * cascading DB row removal. Retention/delete workers use this.
 */
export type VoiceRecordingCleanupRef = {
  recordingId: string;
  sessionId: string;
  storageKey: string;
  conversationId: string | null;
};

export function voiceRecordingCleanupRefs(
  rows: Array<{
    id: string;
    sessionId: string;
    storageKey: string | null;
    conversationId: string | null;
  }>,
): VoiceRecordingCleanupRef[] {
  return rows.flatMap((row) =>
    row.storageKey
      ? [
          {
            recordingId: row.id,
            sessionId: row.sessionId,
            storageKey: row.storageKey,
            conversationId: row.conversationId,
          },
        ]
      : [],
  );
}
