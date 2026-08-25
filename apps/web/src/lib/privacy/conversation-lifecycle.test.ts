import { beforeEach, describe, expect, it, vi } from "vitest";

const getOwnedAssistant = vi.fn();
const deleteReturning = vi.fn();
const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
const del = vi.fn(() => ({ where: deleteWhere }));
const db = vi.fn(() => ({ delete: del }));

vi.mock("@/lib/assistants", () => ({
  getOwnedAssistant: (...args: unknown[]) => getOwnedAssistant(...args),
}));

vi.mock("@/lib/db", () => ({
  db: () => db(),
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
