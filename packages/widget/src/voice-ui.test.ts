// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceMediaDeps } from "@nightzeros/chatai-widget-core";

import { mountWidget } from "./mount";

vi.mock("./styles.css?inline", () => ({ default: "" }));

type Listener = (event: unknown) => void;

function emitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: unknown = {}) {
      listeners.get(type)?.forEach((fn) => fn(event));
    },
  };
}

function fakeMedia(opts: { micError?: Error } = {}) {
  const state = {
    tracks: [] as Array<{ stopped: boolean; stop(): void }>,
    peers: [] as Array<{ closed: boolean; channel: ReturnType<typeof emitter> }>,
  };
  const media: VoiceMediaDeps = {
    async getUserMedia() {
      if (opts.micError) throw opts.micError;
      const track = { stopped: false, stop() { track.stopped = true; } };
      state.tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    },
    createPeerConnection() {
      const channel = emitter();
      const peer = {
        ...emitter(),
        closed: false,
        channel,
        connectionState: "new",
        iceGatheringState: "complete",
        localDescription: null as { sdp: string } | null,
        addTrack() {},
        getSenders: () => [],
        createDataChannel: () => channel,
        createOffer: async () => ({ type: "offer", sdp: "v=0\r\n" }),
        async setLocalDescription(d: { sdp: string }) {
          peer.localDescription = d;
        },
        async setRemoteDescription() {},
        close() {
          peer.closed = true;
        },
      };
      state.peers.push(peer);
      return peer as unknown as RTCPeerConnection;
    },
    createAudioContext: () => null,
    createAudioElement: () => null,
  };
  return { media, state };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function installFetch(
  voiceEnabled: boolean,
  mint: Record<string, unknown> = { ephemeral: true, conversationId: null },
  consentRequired = false,
  overrides: { mintStatus?: number; endBody?: Record<string, unknown>; heartbeat?: () => Response } = {},
) {
  const calls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      bodies.push(init?.body ? JSON.parse(String(init.body)) : {});
      if (String(url).endsWith("/config")) {
        return Response.json({
          assistantId: "asst_pub",
          name: "Demo assistant",
          welcomeMessage: "Welcome",
          settings: {},
          voice: { enabled: voiceEnabled, recording: { consentRequired } },
        });
      }
      if (String(url).endsWith("/api/v1/voice/sessions")) {
        if (overrides.mintStatus) return Response.json(mint, { status: overrides.mintStatus });
        return Response.json({
          sessionId: "vs_1",
          sdpAnswer: "v=0\r\n",
          ...mint,
          ...(overrides.heartbeat ? { controlToken: "ct_1", heartbeatIntervalMs: 5_000 } : {}),
        });
      }
      if (String(url).endsWith("/heartbeat") && overrides.heartbeat) return overrides.heartbeat();
      return Response.json(overrides.endBody ?? { ended: true });
    }),
  );
  return Object.assign(calls, { bodies });
}

async function openWidget(
  options: {
    voiceEnabled?: boolean;
    voice?: boolean;
    micError?: Error;
    mint?: Record<string, unknown>;
    consentRequired?: boolean;
    mintStatus?: number;
    endBody?: Record<string, unknown>;
    heartbeat?: () => Response;
  } = {},
) {
  const calls = installFetch(options.voiceEnabled ?? true, options.mint, options.consentRequired, {
    mintStatus: options.mintStatus,
    endBody: options.endBody,
    heartbeat: options.heartbeat,
  });
  const { media, state } = fakeMedia({ micError: options.micError });
  const target = document.createElement("div");
  document.body.append(target);
  const instance = mountWidget(target, {
    assistantId: "asst_pub",
    apiUrl: "https://chat.example.com",
    voiceMedia: media,
    ...(options.voice === false ? { voice: false } : {}),
  });
  await flush();
  const root = target.shadowRoot!;
  (root.querySelector('[aria-label="Open chat"]') as HTMLButtonElement).click();
  await flush();
  return { root, instance, state, calls };
}

const mic = (root: ShadowRoot) => root.querySelector(".chatai-mic") as HTMLButtonElement | null;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("widget Voice UI", () => {
  it("offers Voice only when the assistant enables it", async () => {
    const off = await openWidget({ voiceEnabled: false });
    expect(mic(off.root)).toBeNull();
    off.instance.destroy();

    const on = await openWidget();
    expect(mic(on.root)?.getAttribute("aria-label")).toBe("Start voice conversation");
    on.instance.destroy();
  });

  it("respects the embedder opt-out even when Voice is enabled", async () => {
    const { root, instance } = await openWidget({ voice: false });
    expect(mic(root)).toBeNull();
    instance.destroy();
  });

  it("starts Voice from the mic toggle, shows live state and turns, and blocks typing", async () => {
    const { root, instance, state } = await openWidget();
    mic(root)!.click();
    await flush();

    expect(mic(root)?.getAttribute("aria-pressed")).toBe("true");
    expect(mic(root)?.getAttribute("aria-label")).toBe("End voice conversation");
    const input = root.querySelector("#chatai-message-input") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toMatch(/voice is on/i);
    expect(root.querySelector(".chatai-voice-meta")?.textContent).toBe("Not saved");

    const channel = state.peers[0]!.channel;
    channel.dispatch("message", { data: JSON.stringify({ type: "session.started" }) });
    channel.dispatch("message", {
      data: JSON.stringify({ type: "session.input_transcript.delta", delta: "Hi there", start_ms: 0, end_ms: 500 }),
    });
    channel.dispatch("message", {
      data: JSON.stringify({ type: "session.output_transcript.delta", delta: "Hello!", start_ms: 900, end_ms: 1_400 }),
    });
    await flush();

    const voiceTurns = Array.from(root.querySelectorAll(".chatai-message.is-voice"));
    expect(voiceTurns.map((node) => node.textContent)).toEqual(["You said:Hi there", "Assistant said:Hello!"]);
    // User speech within the activity window outranks assistant audio.
    expect(root.querySelector('[role="status"]')?.textContent).toMatch(/^(Hearing you|Speaking)$/);
    expect(root.querySelector(".chatai-transcript")?.getAttribute("aria-live")).toBe("off");

    mic(root)!.click();
    await flush();
    expect(state.tracks[0]?.stopped).toBe(true);
    expect(input.disabled).toBe(false);
    expect(root.querySelectorAll(".chatai-message.is-voice")).toHaveLength(2);
    instance.destroy();
  });

  it("says the Voice transcript is not saved when storage is on but transcripts are off", async () => {
    const { root, instance } = await openWidget({
      mint: { ephemeral: false, transcriptSaved: false, conversationId: "conv_1" },
    });
    mic(root)!.click();
    await flush();
    expect(root.querySelector(".chatai-voice-meta")?.textContent).toBe("Voice transcript not saved");
    instance.destroy();
  });

  it("shows no saving note when the Voice transcript is saved", async () => {
    const { root, instance } = await openWidget({
      mint: { ephemeral: false, transcriptSaved: true, conversationId: "conv_1" },
    });
    mic(root)!.click();
    await flush();
    expect(root.querySelector(".chatai-voice-meta")?.textContent).toBe("");
    instance.destroy();
  });

  it("closing the panel releases the microphone and media", async () => {
    const { root, instance, state, calls } = await openWidget();
    mic(root)!.click();
    await flush();

    (root.querySelector(".chatai-close") as HTMLButtonElement).click();
    await flush();
    expect(state.tracks[0]?.stopped).toBe(true);
    expect(state.peers[0]?.closed).toBe(true);
    expect(calls.some((url) => url.endsWith("/api/v1/voice/sessions/vs_1/end"))).toBe(true);
    instance.destroy();
  });

  it("unmounting mid-session releases the microphone", async () => {
    const { root, instance, state } = await openWidget();
    mic(root)!.click();
    await flush();
    instance.destroy();
    await flush();
    expect(state.tracks[0]?.stopped).toBe(true);
    expect(state.peers[0]?.closed).toBe(true);
  });

  it("explains a denied microphone and lets the visitor go back to typing", async () => {
    const { root, instance } = await openWidget({ micError: new DOMException("denied", "NotAllowedError") });
    mic(root)!.click();
    await flush();

    expect(root.querySelector(".chatai-voice-error")?.textContent).toMatch(/microphone access is blocked/i);
    expect(root.querySelector('[role="status"]')?.textContent).toMatch(/microphone access is blocked/i);
    const keepTyping = Array.from(root.querySelectorAll(".chatai-voice-bar button")).find(
      (button) => button.textContent === "Keep typing",
    ) as HTMLButtonElement;
    keepTyping.click();
    await flush();
    expect(root.querySelector(".chatai-voice-bar")).toBeNull();
    expect((root.querySelector("#chatai-message-input") as HTMLInputElement).disabled).toBe(false);
    instance.destroy();
  });

  it("shows the recording disclosure before any microphone request; Agree starts a recorded session", async () => {
    const { root, instance, state, calls } = await openWidget({
      consentRequired: true,
      mint: { ephemeral: false, transcriptSaved: true, recording: true, conversationId: "conv_1" },
    });
    mic(root)!.click();
    await flush();

    const consent = root.querySelector(".chatai-voice-consent") as HTMLElement;
    expect(consent).not.toBeNull();
    expect(consent.getAttribute("role")).toBe("group");
    expect(root.getElementById(consent.getAttribute("aria-labelledby")!)?.textContent).toMatch(/recorded/i);
    expect(root.activeElement).toBe(consent);
    expect(state.tracks).toHaveLength(0);
    expect(calls.some((url) => url.endsWith("/api/v1/voice/sessions"))).toBe(false);

    (root.querySelector(".chatai-consent-accept") as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector(".chatai-voice-consent")).toBeNull();
    expect(state.tracks).toHaveLength(1);
    const mintIndex = calls.findIndex((url) => url.endsWith("/api/v1/voice/sessions"));
    expect(calls.bodies[mintIndex]).toMatchObject({ recordingConsent: true });
    expect(root.querySelector(".chatai-voice-meta")?.textContent).toBe("Recording");
    instance.destroy();
  });

  it("Cancel (or Escape) on the disclosure returns to typing without touching the mic", async () => {
    const { root, instance, state, calls } = await openWidget({ consentRequired: true });
    mic(root)!.click();
    await flush();
    (root.querySelector(".chatai-consent-cancel") as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector(".chatai-voice-consent")).toBeNull();
    expect(root.activeElement?.id).toBe("chatai-message-input");

    mic(root)!.click();
    await flush();
    const consent = root.querySelector(".chatai-voice-consent") as HTMLElement;
    consent.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(root.querySelector(".chatai-voice-consent")).toBeNull();
    // Escape cancelled the disclosure without closing the panel.
    expect(root.querySelector("#chatai-message-input")).not.toBeNull();
    expect(state.tracks).toHaveLength(0);
    expect(calls.some((url) => url.endsWith("/api/v1/voice/sessions"))).toBe(false);
    instance.destroy();
  });

  it("shows no disclosure when the session is not recorded", async () => {
    const { root, instance, state } = await openWidget({ consentRequired: false });
    mic(root)!.click();
    await flush();
    expect(root.querySelector(".chatai-voice-consent")).toBeNull();
    expect(state.tracks).toHaveLength(1);
    instance.destroy();
  });

  it("a Voice-minutes refusal shows the neutral unavailable copy, never plan details", async () => {
    const { root, instance, state } = await openWidget({
      mintStatus: 403,
      mint: { error: "Voice isn't available right now.", reason: "voice_unavailable" },
    });
    mic(root)!.click();
    await flush();

    const text = root.querySelector(".chatai-voice-error")?.textContent ?? "";
    expect(text).toBe("Voice isn't available right now. You can keep typing.");
    expect(root.textContent).not.toMatch(/minute|plan|quota|limit/i);
    expect(state.tracks[0]?.stopped).toBe(true);
    instance.destroy();
  });

  it("a call ChatAI ended shows the neutral 'unavailable' notice and returns to typing", async () => {
    const { root, instance, state } = await openWidget({
      endBody: { sessionId: "vs_1", status: "ended", endReason: "voice_unavailable" },
    });
    mic(root)!.click();
    await flush();
    const channel = state.peers[0]!.channel;
    channel.dispatch("message", { data: JSON.stringify({ type: "session.started" }) });
    channel.dispatch("message", { data: JSON.stringify({ type: "session.closed", reason: "close_requested" }) });
    await flush();

    expect(root.querySelector(".chatai-voice-bar.is-notice")?.textContent).toContain(
      "Voice is unavailable for the rest of this conversation, but we can keep chatting here.",
    );
    expect(root.querySelector('[role="status"]')?.textContent).toMatch(/voice is unavailable/i);
    expect(root.textContent).not.toMatch(/minute|plan|quota|limit|billing|usage/i);
    expect(state.tracks[0]?.stopped).toBe(true);
    const input = root.querySelector("#chatai-message-input") as HTMLInputElement;
    expect(input.disabled).toBe(false);

    (root.querySelector(".chatai-voice-bar.is-notice button") as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector(".chatai-voice-bar")).toBeNull();
    instance.destroy();
  });

  it("losing ChatAI control shows a neutral Reconnecting state, then disconnects back to typing", async () => {
    const { root, instance, state } = await openWidget({
      heartbeat: () => Response.json({ error: "unavailable" }, { status: 503 }),
    });
    vi.useFakeTimers();
    try {
      mic(root)!.click();
      await vi.advanceTimersByTimeAsync(0);
      state.peers[0]!.channel.dispatch("message", { data: JSON.stringify({ type: "session.started" }) });
      await vi.advanceTimersByTimeAsync(10_000);

      const input = root.querySelector("#chatai-message-input") as HTMLInputElement;
      expect(root.querySelector(".chatai-voice-label")?.textContent).toBe("Reconnecting…");
      expect(root.querySelector('[role="status"]')?.textContent).toBe("Reconnecting…");
      expect(root.querySelector(".chatai-voice-bar")?.getAttribute("data-phase")).toBe("reconnecting");
      expect(input.disabled).toBe(true);
      expect(state.peers[0]?.closed).toBe(false);
      expect(state.tracks[0]?.stopped).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(root.querySelector(".chatai-voice-bar.is-notice")?.textContent).toContain(
        "Voice disconnected. You can keep typing here.",
      );
      expect(root.querySelector('[role="status"]')?.textContent).toBe("Voice disconnected. You can keep typing here.");
      expect(root.textContent).not.toMatch(/sideband|provider|heartbeat|quota|minute|plan|recover/i);
      expect(input.disabled).toBe(false);
      expect(state.tracks[0]?.stopped).toBe(true);
      expect(state.peers[0]?.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    instance.destroy();
  });
});
