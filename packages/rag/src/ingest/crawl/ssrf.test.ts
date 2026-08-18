import { describe, expect, it } from "vitest";

import { assertSafeUrl, isBlockedAddress } from "./ssrf";

const publicLookup = async () => [{ address: "93.184.216.34" }];
const privateLookup = async () => [{ address: "127.0.0.1" }];

describe("assertSafeUrl", () => {
  it("rejects non-http schemes", async () => {
    await expect(assertSafeUrl("ftp://example.com", publicLookup)).rejects.toThrow(/http or https/i);
  });

  it("rejects credentials in the URL", async () => {
    await expect(assertSafeUrl("https://user:pass@example.com", publicLookup)).rejects.toThrow(
      /credentials/i,
    );
  });

  it("rejects localhost hostnames", async () => {
    await expect(assertSafeUrl("https://localhost/docs", publicLookup)).rejects.toThrow(
      /restricted hosts/i,
    );
  });

  it("rejects private resolved addresses", async () => {
    await expect(assertSafeUrl("https://example.com", privateLookup)).rejects.toThrow(/private/i);
  });

  it("allows public URLs after DNS lookup", async () => {
    const url = await assertSafeUrl("example.com/docs", publicLookup);
    expect(url.hostname).toBe("example.com");
    expect(url.pathname).toBe("/docs");
  });
});

describe("isBlockedAddress", () => {
  it("blocks common private ranges and metadata IP", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
  });
});
