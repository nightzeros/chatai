import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

vi.mock("@/lib/db", () => ({
  db: () => ({ select }),
}));

const env = vi.hoisted(() => ({
  VOICE_PROVIDER: "gpt-live" as "gpt-live" | "mock",
  VOICE_OPENAI_API_KEY: undefined as string | undefined,
  VOICE_OPENAI_BASE_URL: "https://api.openai.com",
}));
vi.mock("@/lib/env", () => ({ env }));

vi.mock("@/lib/voice", async () => {
  const credentials = await vi.importActual<typeof import("@/lib/voice/credentials")>("@/lib/voice/credentials");
  return {
    isVoiceServiceAvailable: (settings: Parameters<typeof credentials.isVoiceServiceAvailable>[0]) =>
      credentials.isVoiceServiceAvailable(settings, env),
    recordingApplies: (p: { ephemeral: boolean; saveAudioRecordings: boolean }) =>
      !p.ephemeral && p.saveAudioRecordings && storage.available,
  };
});

const storage = vi.hoisted(() => ({ available: false }));

vi.mock("@/lib/cors", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  jsonWithCors: (body: unknown, init?: { status?: number }) => Response.json(body, { status: init?.status ?? 200 }),
}));

vi.mock("@/lib/policies/policy-response", () => ({
  policyViolationResponse: (violation: { status: number; message: string }) =>
    Response.json({ error: violation.message }, { status: violation.status }),
}));

const enforceWidgetRequest = vi.fn();
vi.mock("@/lib/policies/security-policy", () => ({
  SecurityPolicy: { fromAssistant: vi.fn(() => ({ enforceWidgetRequest })) },
}));

function assistantRow(
  voiceSettings: Record<string, unknown> | null,
  privacySettings: Record<string, unknown> = {},
) {
  return {
    id: "asst_internal",
    publicId: "asst_public",
    name: "Demo",
    welcomeMessage: "Hi",
    settings: {},
    securitySettings: {},
    privacySettings,
    voiceSettings,
  };
}

async function getConfig() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost:3000/api/v1/assistants/asst_public/config"), {
    params: Promise.resolve({ publicId: "asst_public" }),
  });
}

describe("GET /api/v1/assistants/:publicId/config voice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceWidgetRequest.mockResolvedValue(null);
    env.VOICE_PROVIDER = "gpt-live";
    env.VOICE_OPENAI_API_KEY = undefined;
    storage.available = false;
  });

  it("is off when the assistant has not enabled public Voice", async () => {
    env.VOICE_OPENAI_API_KEY = "sk-voice";
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: false })]);
    const body = await (await getConfig()).json();
    expect(body.voice).toEqual({ enabled: false, recording: { consentRequired: false } });
  });

  it("is off when the instance has no Voice provider configured", async () => {
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: true })]);
    const body = await (await getConfig()).json();
    expect(body.voice).toEqual({ enabled: false, recording: { consentRequired: false } });
  });

  it("is off for an unsupported provider override", async () => {
    env.VOICE_OPENAI_API_KEY = "sk-voice";
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: true, provider: "other" })]);
    const body = await (await getConfig()).json();
    expect(body.voice).toEqual({ enabled: false, recording: { consentRequired: false } });
  });

  it("exposes only the public switch when Voice is enabled and available", async () => {
    env.VOICE_OPENAI_API_KEY = "sk-voice-secret";
    selectLimit.mockResolvedValueOnce([
      assistantRow({ enabled: true, model: "gpt-live-x", voiceId: "marin", saveTranscripts: true }),
    ]);
    const response = await getConfig();
    const text = await response.text();
    expect(JSON.parse(text).voice).toEqual({ enabled: true, recording: { consentRequired: false } });
    expect(text).not.toContain("sk-voice-secret");
    expect(text).not.toContain("gpt-live-x");
    expect(text).not.toContain("marin");
    expect(text).not.toContain("saveTranscripts");
  });

  it("is available with the mock provider and no credentials", async () => {
    env.VOICE_PROVIDER = "mock";
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: true })]);
    const body = await (await getConfig()).json();
    expect(body.voice).toEqual({ enabled: true, recording: { consentRequired: false } });
  });

  it("requires the recording disclosure only when recording would actually happen", async () => {
    env.VOICE_PROVIDER = "mock";
    storage.available = true;
    const recorded = { enabled: true, saveAudioRecordings: true };

    selectLimit.mockResolvedValueOnce([assistantRow(recorded)]);
    const text = await (await getConfig()).text();
    expect(JSON.parse(text).voice).toEqual({ enabled: true, recording: { consentRequired: true } });
    expect(text).not.toContain("saveAudioRecordings");
    expect(text).not.toContain("bucket");

    // Global no-store: never recorded, so no disclosure.
    selectLimit.mockResolvedValueOnce([assistantRow(recorded, { storeConversations: false })]);
    expect((await (await getConfig()).json()).voice.recording).toEqual({ consentRequired: false });

    // Recording off (the default).
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: true })]);
    expect((await (await getConfig()).json()).voice.recording).toEqual({ consentRequired: false });

    // Public Voice off.
    selectLimit.mockResolvedValueOnce([assistantRow({ ...recorded, enabled: false })]);
    expect((await (await getConfig()).json()).voice.recording).toEqual({ consentRequired: false });

    // Object storage not configured on this instance.
    storage.available = false;
    selectLimit.mockResolvedValueOnce([assistantRow(recorded)]);
    expect((await (await getConfig()).json()).voice.recording).toEqual({ consentRequired: false });
  });

  it("enforces widget security before revealing any config", async () => {
    enforceWidgetRequest.mockResolvedValueOnce({ status: 403, message: "Domain not allowed." });
    selectLimit.mockResolvedValueOnce([assistantRow({ enabled: true })]);
    const response = await getConfig();
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("voice");
  });
});
