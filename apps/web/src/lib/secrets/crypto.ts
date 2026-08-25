import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Default / current envelope version written by {@link encryptSecret}. */
export const CURRENT_ENCRYPTION_KEY_VERSION = 1;

const VERSIONED_CIPHERTEXT = /^v(\d+):([\s\S]+)$/;

export type EncryptionKeyring = Map<number, Buffer>;

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

export type EncryptionKeyringEnv = {
  ENCRYPTION_KEY?: string | null;
  /** Version label for ENCRYPTION_KEY (default 1). Used when encrypting new secrets. */
  ENCRYPTION_KEY_VERSION?: number | null;
  /** Optional prior key kept only for decrypt during rotation. */
  ENCRYPTION_KEY_PREVIOUS?: string | null;
  ENCRYPTION_KEY_PREVIOUS_VERSION?: number | null;
};

export type LoadedEncryptionKeyring = {
  currentVersion: number;
  keys: EncryptionKeyring;
};

/**
 * Build a keyring for encrypt/decrypt.
 * - Current key encrypts new secrets (version from ENCRYPTION_KEY_VERSION, default 1).
 * - Previous key (optional) decrypts older envelopes after rotation.
 * Returns null when no current ENCRYPTION_KEY is set.
 */
export function loadEncryptionKeyring(env: EncryptionKeyringEnv): LoadedEncryptionKeyring | null {
  const current = loadEncryptionKey(env.ENCRYPTION_KEY);
  if (!current) {
    return null;
  }

  const currentVersion =
    env.ENCRYPTION_KEY_VERSION && env.ENCRYPTION_KEY_VERSION > 0
      ? env.ENCRYPTION_KEY_VERSION
      : CURRENT_ENCRYPTION_KEY_VERSION;

  const keys: EncryptionKeyring = new Map([[currentVersion, current]]);

  const previous = loadEncryptionKey(env.ENCRYPTION_KEY_PREVIOUS);
  if (previous) {
    const previousVersion =
      env.ENCRYPTION_KEY_PREVIOUS_VERSION && env.ENCRYPTION_KEY_PREVIOUS_VERSION > 0
        ? env.ENCRYPTION_KEY_PREVIOUS_VERSION
        : currentVersion - 1;
    if (previousVersion < 1) {
      throw new Error("ENCRYPTION_KEY_PREVIOUS_VERSION must be a positive integer.");
    }
    if (previousVersion === currentVersion) {
      throw new Error("ENCRYPTION_KEY_PREVIOUS_VERSION must differ from ENCRYPTION_KEY_VERSION.");
    }
    keys.set(previousVersion, previous);
  }

  return { currentVersion, keys };
}

export function currentKeyFromRing(
  loaded: LoadedEncryptionKeyring,
): { version: number; key: Buffer } {
  const key = loaded.keys.get(loaded.currentVersion);
  if (!key) {
    throw new Error(`Encryption keyring missing current version v${loaded.currentVersion}.`);
  }
  return { version: loaded.currentVersion, key };
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Output: `v{version}:` + base64(iv || authTag || ciphertext) for rotation-ready envelopes.
 */
export function encryptSecret(
  plaintext: string,
  key: Buffer,
  version: number = CURRENT_ENCRYPTION_KEY_VERSION,
): string {
  assertKey(key);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Encryption key version must be a positive integer.");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `v${version}:${payload}`;
}

/**
 * Decrypt a ciphertext produced by {@link encryptSecret}.
 * Pass a single key (tests / known version) or a keyring (production; looks up by envelope version).
 */
export function decryptSecret(ciphertext: string, keyOrKeyring: Buffer | EncryptionKeyring): string {
  const { version, payload } = parseCiphertextEnvelope(ciphertext);
  const key = Buffer.isBuffer(keyOrKeyring)
    ? keyOrKeyring
    : keyOrKeyring.get(version);
  if (!key) {
    throw new Error(
      `No encryption key loaded for ciphertext version v${version}. Set ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS.`,
    );
  }
  assertKey(key);

  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Ciphertext is too short.");
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function parseCiphertextEnvelope(ciphertext: string): { version: number; payload: string } {
  const trimmed = ciphertext.trim();
  const match = VERSIONED_CIPHERTEXT.exec(trimmed);
  if (match) {
    return { version: Number(match[1]), payload: match[2] ?? "" };
  }
  // Legacy unversioned blobs (if any) decrypt as v1.
  return { version: CURRENT_ENCRYPTION_KEY_VERSION, payload: trimmed };
}

function assertKey(key: Buffer) {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes.`);
  }
}
