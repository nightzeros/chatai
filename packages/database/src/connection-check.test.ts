import { describe, expect, it } from "vitest";

import { checkDatabaseUrlPair } from "./connection-check";

const pooled =
  "postgresql://u:p@ep-example-alpha-a1b2c3d4-pooler.c-1.us-east-1.aws.neon.tech/neondb?sslmode=require";

describe("checkDatabaseUrlPair", () => {
  it("accepts the direct URL of the same Neon endpoint", () => {
    expect(
      checkDatabaseUrlPair(
        pooled,
        "postgresql://u:p@ep-example-alpha-a1b2c3d4.c-1.us-east-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toBeNull();
  });

  it("flags a direct URL from a different Neon branch", () => {
    const mismatch = checkDatabaseUrlPair(
      pooled,
      "postgresql://u:p@ep-example-beta-e5f6g7h8.c-1.us-east-1.aws.neon.tech/neondb?sslmode=require",
    );
    expect(mismatch?.reason).toContain("ep-example-alpha-a1b2c3d4");
    expect(mismatch?.reason).toContain("ep-example-beta-e5f6g7h8");
  });

  it("flags different database names on any host", () => {
    expect(
      checkDatabaseUrlPair("postgresql://u:p@pgbouncer:6432/app", "postgresql://u:p@db:5432/other"),
    ).not.toBeNull();
  });

  it("allows different non-Neon hosts for the same database", () => {
    expect(
      checkDatabaseUrlPair("postgresql://u:p@pgbouncer:6432/app", "postgresql://u:p@db:5432/app"),
    ).toBeNull();
    expect(checkDatabaseUrlPair(pooled, undefined)).toBeNull();
  });
});
