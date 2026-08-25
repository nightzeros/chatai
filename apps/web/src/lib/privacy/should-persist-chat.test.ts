import { describe, expect, it } from "vitest";

import { shouldPersistChatTranscript } from "./should-persist-chat";

describe("shouldPersistChatTranscript", () => {
  it("persists when storeConversations is true for widget/api", () => {
    expect(
      shouldPersistChatTranscript({
        assistant: { privacySettings: { storeConversations: true } },
        source: "widget",
        assistantOwnerId: "owner",
        sessionUserId: null,
      }),
    ).toBe(true);
    expect(
      shouldPersistChatTranscript({
        assistant: { privacySettings: { storeConversations: true } },
        source: "api",
        assistantOwnerId: "owner",
      }),
    ).toBe(true);
  });

  it("does not persist widget/api when storeConversations is false", () => {
    expect(
      shouldPersistChatTranscript({
        assistant: { privacySettings: { storeConversations: false } },
        source: "widget",
        assistantOwnerId: "owner",
        sessionUserId: "someone-else",
      }),
    ).toBe(false);
  });

  it("always persists owner playground even when storeConversations is false", () => {
    expect(
      shouldPersistChatTranscript({
        assistant: { privacySettings: { storeConversations: false } },
        source: "playground",
        assistantOwnerId: "owner",
        sessionUserId: "owner",
      }),
    ).toBe(true);
  });

  it("persists playground source via PrivacyPolicy playground rule", () => {
    expect(
      shouldPersistChatTranscript({
        assistant: { privacySettings: { storeConversations: false } },
        source: "playground",
        assistantOwnerId: "owner",
        sessionUserId: null,
      }),
    ).toBe(true);
  });
});
