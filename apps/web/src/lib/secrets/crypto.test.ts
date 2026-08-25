import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CURRENT_ENCRYPTION_KEY_VERSION,
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  loadEncryptionKeyring,
  parseCiphertextEnvelope,
} from "./crypto";

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

  it("round-trips plaintext with a versioned envelope", () => {
    const ciphertext = encryptSecret("sk-test-secret", key);
    expect(ciphertext.startsWith(`v${CURRENT_ENCRYPTION_KEY_VERSION}:`)).toBe(true);
    expect(decryptSecret(ciphertext, key)).toBe("sk-test-secret");
  });

  it("fails with the wrong key", () => {
    const ciphertext = encryptSecret("secret", key);
    expect(() => decryptSecret(ciphertext, randomBytes(32))).toThrow();
  });

  it("fails when ciphertext is tampered", () => {
    const ciphertext = encryptSecret("secret", key);
    const { payload } = parseCiphertextEnvelope(ciphertext);
    const buf = Buffer.from(payload, "base64");
    const last = buf[buf.length - 1];
    if (last === undefined) {
      throw new Error("expected ciphertext bytes");
    }
    buf[buf.length - 1] = last ^ 0xff;
    expect(() => decryptSecret(`v1:${buf.toString("base64")}`, key)).toThrow();
  });

  it("decrypts with a keyring during rotation", () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const oldCipher = encryptSecret("legacy-key", oldKey, 1);
    const ring = loadEncryptionKeyring({
      ENCRYPTION_KEY: newKey.toString("base64"),
      ENCRYPTION_KEY_VERSION: 2,
      ENCRYPTION_KEY_PREVIOUS: oldKey.toString("base64"),
      ENCRYPTION_KEY_PREVIOUS_VERSION: 1,
    });
    expect(ring).not.toBeNull();
    expect(decryptSecret(oldCipher, ring!.keys)).toBe("legacy-key");

    const fresh = encryptSecret("new-key", ring!.keys.get(2)!, 2);
    expect(parseCiphertextEnvelope(fresh).version).toBe(2);
    expect(decryptSecret(fresh, ring!.keys)).toBe("new-key");
  });

  it("accepts legacy unversioned ciphertext as v1", () => {
    // Simulate pre-version envelope: raw base64 payload only
    const iv = randomBytes(12);
    // Build via encrypt then strip prefix
    const versioned = encryptSecret("legacy", key, 1);
    const { payload } = parseCiphertextEnvelope(versioned);
    expect(decryptSecret(payload, key)).toBe("legacy");
    void iv;
  });
});
