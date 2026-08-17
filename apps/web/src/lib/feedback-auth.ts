type FeedbackAuthorization = {
  messageRole: "user" | "assistant" | "system";
  conversationVisitorId: string | null;
  providedVisitorId: string | undefined;
  assistantOwnerId: string;
  sessionUserId: string | null | undefined;
};

export function canSubmitFeedback({
  messageRole,
  conversationVisitorId,
  providedVisitorId,
  assistantOwnerId,
  sessionUserId,
}: FeedbackAuthorization) {
  if (messageRole !== "assistant") return false;
  if (sessionUserId === assistantOwnerId) return true;
  return conversationVisitorId !== null && conversationVisitorId === providedVisitorId;
}
