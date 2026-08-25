import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn();
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const insertValues = vi.fn();
const insert = vi.fn(() => ({ values: insertValues }));
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));
const deleteWhere = vi.fn();
const del = vi.fn(() => ({ where: deleteWhere }));
const db = vi.fn(() => ({ select, insert, update, delete: del }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "secret-id-1",
}));

function whereWithRows(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  return Object.assign(Promise.resolve(rows), { limit });
}

describe("provider secrets", () => {
  const key = randomBytes(32).toString("base64");
  const env = { ENCRYPTION_KEY: key, ENCRYPTION_KEY_VERSION: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    selectWhere.mockImplementation(() => whereWithRows([]));
    insertValues.mockResolvedValue(undefined);
    updateWhere.mockResolvedValue(undefined);
    deleteWhere.mockResolvedValue(undefined);
  });

  it("upserts encrypted ciphertext and returns only metadata", async () => {
    const { upsertProviderSecret } = await import("./provider-secrets");
    const meta = await upsertProviderSecret({
      assistantId: "asst-1",
      kind: "chat",
      provider: "openai",
      plaintext: "sk-live-abcdefgh",
      env,
    });

    expect(meta).toEqual({
      kind: "chat",
      provider: "openai",
      keyPrefix: "efgh",
    });
    expect(JSON.stringify(meta)).not.toContain("sk-live");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: "asst-1",
        kind: "chat",
        provider: "openai",
        keyPrefix: "efgh",
        ciphertext: expect.stringMatching(/^v1:/),
      }),
    );
    const inserted = insertValues.mock.calls[0]?.[0] as { ciphertext: string };
    expect(inserted.ciphertext).not.toContain("sk-live");
  });

  it("decrypts stored secrets for server-side use only", async () => {
    const { encryptSecret, loadEncryptionKey } = await import("./crypto");
    const buf = loadEncryptionKey(key)!;
    const ciphertext = encryptSecret("sk-server-only", buf, 1);
    selectWhere.mockImplementation(() =>
      whereWithRows([{ kind: "chat", provider: "openai", ciphertext }]),
    );

    const { getDecryptedProviderSecrets } = await import("./provider-secrets");
    const secrets = await getDecryptedProviderSecrets("asst-1", env);
    expect(secrets.chat?.apiKey).toBe("sk-server-only");
  });

  it("listProviderSecretMeta never selects ciphertext", async () => {
    selectWhere.mockImplementation(() =>
      whereWithRows([{ kind: "chat", provider: "openai", keyPrefix: "wxyz" }]),
    );
    const { listProviderSecretMeta } = await import("./provider-secrets");
    const meta = await listProviderSecretMeta("asst-1");
    expect(meta).toEqual([{ kind: "chat", provider: "openai", keyPrefix: "wxyz" }]);
    const callArgs = select.mock.calls[0] as unknown as [Record<string, unknown>] | undefined;
    const columns = callArgs?.[0];
    expect(columns?.kind).toBeDefined();
    expect(columns?.provider).toBeDefined();
    expect(columns?.keyPrefix).toBeDefined();
    expect(columns?.ciphertext).toBeUndefined();
  });
});
