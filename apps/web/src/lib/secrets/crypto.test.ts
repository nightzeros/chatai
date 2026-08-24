import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, loadEncryptionKey } from "./crypto";

describe("loadEncryptionKey", () => {
  it("returns null for empty input", () => {
    expect(loadEncryptionKey(undefined)).toBeNull();
    expect(loadEncryptionKey("")).toBeNull();
    expect(loadEncryptionKey("   ")).toBeNull();
  });

  it("loads hex and base64 keys", () => {
    const bytes = randomBytes(32);
    const hex = bytes.toString("hex");
    const b64 = bytes.toString("base64");

    expect(loadEncryptionKey(hex)?.equals(bytes)).toBe(true);
    expect(loadEncryptionKey(`hex:${hex}`)?.equals(bytes)).toBe(true);
    expect(loadEncryptionKey(b64)?.equals(bytes)).toBe(true);
    expect(loadEncryptionKey(`base64:${b64}`)?.equals(bytes)).toBe(true);
  });

  it("rejects wrong-length keys", () => {
    expect(() => loadEncryptionKey(Buffer.alloc(16).toString("hex"))).toThrow(/32 bytes/);
  });
});

describe("encryptSecret / decryptSecret", () => {
  const key = randomBytes(32);

  it("round-trips plaintext", () => {
    const ciphertext = encryptSecret("sk-test-secret", key);
    expect(decryptSecret(ciphertext, key)).toBe("sk-test-secret");
  });

  it("fails with the wrong key", () => {
    const ciphertext = encryptSecret("secret", key);
    expect(() => decryptSecret(ciphertext, randomBytes(32))).toThrow();
  });

  it("fails when ciphertext is tampered", () => {
    const ciphertext = encryptSecret("secret", key);
    const buf = Buffer.from(ciphertext, "base64");
    const last = buf[buf.length - 1];
    if (last === undefined) {
      throw new Error("expected ciphertext bytes");
    }
    buf[buf.length - 1] = last ^ 0xff;
    expect(() => decryptSecret(buf.toString("base64"), key)).toThrow();
  });
});
