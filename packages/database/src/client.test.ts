import { afterEach, describe, expect, it, vi } from "vitest";

const postgres = vi.fn((..._args: unknown[]) => ({}));
vi.mock("postgres", () => ({ default: postgres }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => ({})) }));

afterEach(() => {
  postgres.mockClear();
});

describe("createDb", () => {
  it("bounds idle, lifetime and connect time so a dropped connection fails fast instead of hanging", async () => {
    const { createDb } = await import("./client");
    createDb("postgresql://u:p@db:5432/app");

    expect(postgres).toHaveBeenCalledWith("postgresql://u:p@db:5432/app", {
      max: 10,
      idle_timeout: 20,
      max_lifetime: 1_800,
      connect_timeout: 10,
      prepare: false,
    });
  });

  it("keeps the timeouts when a caller overrides the pool size", async () => {
    const { createDb } = await import("./client");
    createDb("postgresql://u:p@db:5432/app", { max: 1 });

    expect(postgres).toHaveBeenCalledWith(
      "postgresql://u:p@db:5432/app",
      expect.objectContaining({ max: 1, idle_timeout: 20, connect_timeout: 10, prepare: false }),
    );
  });
});
