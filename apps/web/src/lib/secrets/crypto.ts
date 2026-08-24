import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Load a 32-byte AES key from env.
 * Accepts:
 * - `base64:<payload>` (or raw base64 of 32 bytes)
 * - `hex:<payload>` (or 64-char hex)
 * Returns null when unset/empty.
 */
export function loadEncryptionKey(raw: string | undefined | null): Buffer | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let key: Buffer;
  if (trimmed.startsWith("base64:")) {
    key = Buffer.from(trimmed.slice("base64:".length), "base64");
  } else if (trimmed.startsWith("hex:")) {
    key = Buffer.from(trimmed.slice("hex:".length), "hex");
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). Use openssl rand -base64 32 or openssl rand -hex 32.`,
    );
  }

  return key;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output: base64(iv || authTag || ciphertext).
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypt ciphertext produced by {@link encryptSecret}.
 */
export function decryptSecret(ciphertext: string, key: Buffer): string {
  assertKey(key);
  const payload = Buffer.from(ciphertext, "base64");
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext is too short.");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function assertKey(key: Buffer) {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes.`);
  }
}
