import { describe, expect, it } from "vitest";

import { canSubmitFeedback } from "./feedback-auth";

describe("canSubmitFeedback", () => {
  it("allows an assistant response to be rated by its matching visitor", () => {
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: "visitor-1",
        providedVisitorId: "visitor-1",
        assistantOwnerId: "owner-1",
        sessionUserId: null,
      }),
    ).toBe(true);
  });

  it("rejects a visitor that does not own the conversation", () => {
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: "visitor-1",
        providedVisitorId: "visitor-2",
        assistantOwnerId: "owner-1",
        sessionUserId: null,
      }),
    ).toBe(false);
  });

  it("rejects anonymous feedback when the visitor token is missing or the conversation has none", () => {
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: "visitor-1",
        providedVisitorId: undefined,
        assistantOwnerId: "owner-1",
        sessionUserId: null,
      }),
    ).toBe(false);
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: null,
        providedVisitorId: "visitor-1",
        assistantOwnerId: "owner-1",
        sessionUserId: null,
      }),
    ).toBe(false);
  });

  it("allows the assistant owner to rate a playground response without a visitor token", () => {
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: "visitor-1",
        providedVisitorId: undefined,
        assistantOwnerId: "owner-1",
        sessionUserId: "owner-1",
      }),
    ).toBe(true);
  });

  it("does not allow rating user messages even when the visitor matches", () => {
    expect(
      canSubmitFeedback({
        messageRole: "user",
        conversationVisitorId: "visitor-1",
        providedVisitorId: "visitor-1",
        assistantOwnerId: "owner-1",
        sessionUserId: null,
      }),
    ).toBe(false);
  });

  it("does not treat a non-owner session as feedback authorization", () => {
    expect(
      canSubmitFeedback({
        messageRole: "assistant",
        conversationVisitorId: "visitor-1",
        providedVisitorId: undefined,
        assistantOwnerId: "owner-1",
        sessionUserId: "another-user",
      }),
    ).toBe(false);
  });
});
