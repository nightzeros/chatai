import {
  and,
  assistantProviderSecrets,
  eq,
  type AssistantProviderSecretKind,
} from "@chatai/database";

import { createId } from "../ids";
import {
  currentKeyFromRing,
  decryptSecret,
  encryptSecret,
  loadEncryptionKeyring,
  type EncryptionKeyring,
} from "./crypto";

export type ProviderSecretMeta = {
  kind: AssistantProviderSecretKind;
  provider: string;
  /** Last 4 characters of the plaintext key for UI masking. */
  keyPrefix: string | null;
};

export type DecryptedProviderSecret = {
  kind: AssistantProviderSecretKind;
  provider: string;
  apiKey: string;
};

export type DecryptedProviderSecrets = {
  chat?: DecryptedProviderSecret;
  embedding?: DecryptedProviderSecret;
};

type EncryptionEnv = {
  ENCRYPTION_KEY?: string | null;
  ENCRYPTION_KEY_VERSION?: number | null;
  ENCRYPTION_KEY_PREVIOUS?: string | null;
  ENCRYPTION_KEY_PREVIOUS_VERSION?: number | null;
};

function requireKeyring(env: EncryptionEnv) {
  const loaded = loadEncryptionKeyring(env);
  if (!loaded) {
    throw new Error(
      "ENCRYPTION_KEY is required to store or use per-assistant provider API keys. Generate one with: openssl rand -base64 32",
    );
  }
  return loaded;
}

/** Public metadata only — never includes ciphertext or plaintext. */
export async function listProviderSecretMeta(
  assistantId: string,
): Promise<ProviderSecretMeta[]> {
  const { db } = await import("@/lib/db");
  const rows = await db()
    .select({
      kind: assistantProviderSecrets.kind,
      provider: assistantProviderSecrets.provider,
      keyPrefix: assistantProviderSecrets.keyPrefix,
    })
    .from(assistantProviderSecrets)
    .where(eq(assistantProviderSecrets.assistantId, assistantId));

  return rows;
}

export function keyPrefixFromSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 4) {
    return trimmed;
  }
  return trimmed.slice(-4);
}

export async function upsertProviderSecret(input: {
  assistantId: string;
  kind: AssistantProviderSecretKind;
  provider: string;
  plaintext: string;
  env: EncryptionEnv;
}): Promise<ProviderSecretMeta> {
  const plaintext = input.plaintext.trim();
  if (!plaintext) {
    throw new Error("API key cannot be empty.");
  }
  if (!input.provider.trim()) {
    throw new Error("Provider is required when saving an API key.");
  }

  const loaded = requireKeyring(input.env);
  const { version, key } = currentKeyFromRing(loaded);
  const ciphertext = encryptSecret(plaintext, key, version);
  const keyPrefix = keyPrefixFromSecret(plaintext);
  const now = new Date();
  const id = createId();

  const { db } = await import("@/lib/db");
  const [existing] = await db()
    .select({ id: assistantProviderSecrets.id })
    .from(assistantProviderSecrets)
    .where(
      and(
        eq(assistantProviderSecrets.assistantId, input.assistantId),
        eq(assistantProviderSecrets.kind, input.kind),
      ),
    )
    .limit(1);

  if (existing) {
    await db()
      .update(assistantProviderSecrets)
      .set({
        provider: input.provider.trim(),
        ciphertext,
        keyPrefix,
        updatedAt: now,
      })
      .where(eq(assistantProviderSecrets.id, existing.id));
  } else {
    await db().insert(assistantProviderSecrets).values({
      id,
      assistantId: input.assistantId,
      kind: input.kind,
      provider: input.provider.trim(),
      ciphertext,
      keyPrefix,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { kind: input.kind, provider: input.provider.trim(), keyPrefix };
}

export async function deleteProviderSecret(
  assistantId: string,
  kind: AssistantProviderSecretKind,
): Promise<void> {
  const { db } = await import("@/lib/db");
  await db()
    .delete(assistantProviderSecrets)
    .where(
      and(
        eq(assistantProviderSecrets.assistantId, assistantId),
        eq(assistantProviderSecrets.kind, kind),
      ),
    );
}

/**
 * Decrypt secrets for server-side model resolution only.
 * Callers must never return plaintext (or ciphertext) through HTTP/JSON APIs.
 */
export async function getDecryptedProviderSecrets(
  assistantId: string,
  env: EncryptionEnv,
): Promise<DecryptedProviderSecrets> {
  const { db } = await import("@/lib/db");
  const rows = await db()
    .select({
      kind: assistantProviderSecrets.kind,
      provider: assistantProviderSecrets.provider,
      ciphertext: assistantProviderSecrets.ciphertext,
    })
    .from(assistantProviderSecrets)
    .where(eq(assistantProviderSecrets.assistantId, assistantId));

  if (rows.length === 0) {
    return {};
  }

  const loaded = requireKeyring(env);
  const result: DecryptedProviderSecrets = {};
  for (const row of rows) {
    const apiKey = decryptSecret(row.ciphertext, loaded.keys);
    const entry: DecryptedProviderSecret = {
      kind: row.kind,
      provider: row.provider,
      apiKey,
    };
    if (row.kind === "chat") {
      result.chat = entry;
    } else {
      result.embedding = entry;
    }
  }
  return result;
}

/** Test helper: decrypt a single ciphertext with an explicit keyring. */
export function decryptProviderCiphertext(
  ciphertext: string,
  keys: EncryptionKeyring,
): string {
  return decryptSecret(ciphertext, keys);
}
