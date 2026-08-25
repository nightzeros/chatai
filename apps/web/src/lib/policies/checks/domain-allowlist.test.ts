import { describe, expect, it } from "vitest";

import {
  isOriginAllowed,
  parseAllowedDomain,
  requestOriginHostname,
} from "./domain-allowlist";

describe("parseAllowedDomain", () => {
  it("normalizes bare hostnames and URLs", () => {
    expect(parseAllowedDomain("Example.COM")).toBe("example.com");
    expect(parseAllowedDomain("https://example.com/path")).toBe("example.com");
    expect(parseAllowedDomain("*.Vercel.app")).toBe("*.vercel.app");
    expect(parseAllowedDomain("localhost:5173")).toBe("localhost");
  });

  it("rejects empty and invalid entries", () => {
    expect(parseAllowedDomain("")).toBeNull();
    expect(parseAllowedDomain("  ")).toBeNull();
    expect(parseAllowedDomain("not a host")).toBeNull();
    expect(parseAllowedDomain("*.*.com")).toBeNull();
  });
});

describe("requestOriginHostname", () => {
  it("reads Origin hostname", () => {
    const request = new Request("http://api.local/chat", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(requestOriginHostname(request)).toBe("localhost");
  });

  it("falls back to Referer when Origin is missing", () => {
    const request = new Request("http://api.local/chat", {
      headers: { Referer: "https://docs.example.com/guide" },
    });
    expect(requestOriginHostname(request)).toBe("docs.example.com");
  });

  it("returns null for missing Origin", () => {
    expect(requestOriginHostname(new Request("http://api.local/chat"))).toBeNull();
  });

  it("returns null for malformed Origin", () => {
    const request = new Request("http://api.local/chat", {
      headers: { Origin: "not-a-url" },
    });
    expect(requestOriginHostname(request)).toBeNull();
  });
});

describe("isOriginAllowed", () => {
  it("allows any origin when the allowlist is empty", () => {
    expect(isOriginAllowed("evil.com", [])).toBe(true);
    expect(isOriginAllowed(null, [])).toBe(true);
    expect(isOriginAllowed(null, ["", "  "])).toBe(true);
  });

  it("allows an exact matching host", () => {
    expect(isOriginAllowed("example.com", ["example.com"])).toBe(true);
    expect(isOriginAllowed("Example.COM", ["example.com"])).toBe(true);
  });

  it("denies a non-matching host", () => {
    expect(isOriginAllowed("evil.com", ["example.com"])).toBe(false);
    expect(isOriginAllowed("localhost", ["example.com"])).toBe(false);
  });

  it("allows localhost when listed", () => {
    expect(isOriginAllowed("localhost", ["localhost", "example.com"])).toBe(true);
  });

  it("denies missing Origin when an allowlist is configured", () => {
    expect(isOriginAllowed(null, ["example.com"])).toBe(false);
  });

  it("denies malformed/null hostname when an allowlist is configured", () => {
    expect(isOriginAllowed(null, ["example.com"])).toBe(false);
  });

  it("supports a single leading wildcard", () => {
    expect(isOriginAllowed("app.vercel.app", ["*.vercel.app"])).toBe(true);
    expect(isOriginAllowed("vercel.app", ["*.vercel.app"])).toBe(false);
    expect(isOriginAllowed("evil.com", ["*.vercel.app"])).toBe(false);
  });
});
