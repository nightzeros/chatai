import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { ADMIN_USER_IDS: "admin-1, admin-2" },
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(),
}));

describe("parseAdminUserIds / isAdminUserId", () => {
  it("parses comma-separated ids and ignores blanks", async () => {
    const { parseAdminUserIds, isAdminUserId } = await import("./admin-auth");
    expect(parseAdminUserIds(" a,b , ,c ")).toEqual(["a", "b", "c"]);
    expect(parseAdminUserIds("")).toEqual([]);
    expect(isAdminUserId("admin-1")).toBe(true);
    expect(isAdminUserId("nope")).toBe(false);
  });
});

describe("requireAdminSession", () => {
  it("returns 401 when there is no session", async () => {
    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValueOnce(null);

    const { requireAdminSession } = await import("./admin-auth");
    const result = await requireAdminSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("returns 403 when the user is not an admin", async () => {
    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: "regular-user", email: "u@example.com", name: "U" },
      session: { id: "s1" },
    } as never);

    const { requireAdminSession } = await import("./admin-auth");
    const result = await requireAdminSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows configured admin user ids", async () => {
    const { getSession } = await import("@/lib/session");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { id: "admin-1", email: "a@example.com", name: "A" },
      session: { id: "s1" },
    } as never);

    const { requireAdminSession } = await import("./admin-auth");
    const result = await requireAdminSession();
    expect(result.ok).toBe(true);
  });
});
