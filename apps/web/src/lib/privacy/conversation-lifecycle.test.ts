import { beforeEach, describe, expect, it, vi } from "vitest";

const getOwnedAssistant = vi.fn();
const deleteReturning = vi.fn();
const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
const del = vi.fn(() => ({ where: deleteWhere }));
const selectLimit = vi.fn(async () => [{ id: "conv-1" }] as Array<{ id: string }>);
const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }));
const db = vi.fn(() => ({ delete: del, select }));
const releaseConversationRecordings = vi.fn<(ids: string[]) => Promise<void>>(async () => undefined);

vi.mock("@/lib/assistants", () => ({
  getOwnedAssistant: (...args: unknown[]) => getOwnedAssistant(...args),
}));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/voice/recording/cleanup", () => ({
  releaseConversationRecordings: (ids: string[]) => releaseConversationRecordings(ids),
}));

vi.mock("@/lib/conversations", () => ({
  getOwnedConversationTranscript: vi.fn(),
}));

describe("deleteOwnedConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies when assistant is not owned", async () => {
    getOwnedAssistant.mockResolvedValueOnce(null);
    const { deleteOwnedConversation } = await import("./conversation-lifecycle");
    await expect(deleteOwnedConversation("user-1", "asst-1", "conv-1")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes when owned and conversation exists", async () => {
    getOwnedAssistant.mockResolvedValueOnce({ id: "asst-1" });
    deleteReturning.mockResolvedValueOnce([{ id: "conv-1" }]);
    const { deleteOwnedConversation } = await import("./conversation-lifecycle");
    await expect(deleteOwnedConversation("user-1", "asst-1", "conv-1")).resolves.toEqual({
      ok: true,
    });
    expect(del).toHaveBeenCalled();
    expect(releaseConversationRecordings).toHaveBeenCalledWith(["conv-1"]);
    expect(releaseConversationRecordings.mock.invocationCallOrder[0]!).toBeLessThan(
      del.mock.invocationCallOrder[0]!,
    );
  });

  it("does not touch recordings of a conversation owned by another assistant", async () => {
    getOwnedAssistant.mockResolvedValueOnce({ id: "asst-1" });
    selectLimit.mockResolvedValueOnce([]);
    const { deleteOwnedConversation } = await import("./conversation-lifecycle");
    await expect(deleteOwnedConversation("user-1", "asst-1", "conv-other")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(releaseConversationRecordings).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("returns not_found when no row deleted", async () => {
    getOwnedAssistant.mockResolvedValueOnce({ id: "asst-1" });
    deleteReturning.mockResolvedValueOnce([]);
    const { deleteOwnedConversation } = await import("./conversation-lifecycle");
    await expect(deleteOwnedConversation("user-1", "asst-1", "missing")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
