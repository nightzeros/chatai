import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const db = vi.fn(() => ({ execute }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 200 when the database responds", async () => {
    execute.mockResolvedValueOnce([]);
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", db: "ok" });
  });

  it("returns 503 when the database is unreachable", async () => {
    execute.mockRejectedValueOnce(new Error("connection refused"));
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error", db: "unreachable" });
  });

  it("returns 503 when DATABASE_URL is missing", async () => {
    db.mockImplementationOnce(() => {
      throw new Error("DATABASE_URL is required");
    });
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error", db: "unreachable" });
  });
});
