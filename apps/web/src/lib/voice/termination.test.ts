import type { RealtimeVoiceProvider, VoiceControlChannel } from "@chatai/voice";
import { MockRealtimeVoiceProvider, type MockControlChannel } from "@chatai/voice/mock";
import { afterEach, describe, expect, it } from "vitest";

import { endProviderSession, setVoiceTerminationSettingsForTests } from "./termination";

async function live(provider = new MockRealtimeVoiceProvider()) {
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: {
      model: "gpt-live-1",
      voice: "marin",
      instructions: "",
      delegationMode: "client",
    } as Parameters<typeof provider.createWebRtcSession>[0]["sessionConfig"],
  });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  channel.subscribe(() => undefined);
  return { provider, channel, providerSessionId: created.providerSessionId };
}

afterEach(() => setVoiceTerminationSettingsForTests(null));

describe("endProviderSession", () => {
  it("attached: hangup, then provider-final usage from session.closed", async () => {
    const { provider, channel, providerSessionId } = await live();
    channel.setUsageSeconds(33);
    const outcome = await endProviderSession({ provider, providerSessionId, channel, reattach: true });
    expect(outcome).toMatchObject({
      hangup: "ok",
      observed: true,
      finalUsageSeconds: 33,
      closedReason: "close_requested",
      sidebandClose: false,
      alreadyGone: false,
    });
    expect(provider.hangups).toEqual([providerSessionId]);
  });

  it("re-attaches a dropped sideband first so final usage is observed", async () => {
    const { provider, channel, providerSessionId } = await live();
    channel.setUsageSeconds(12);
    channel.simulateSidebandDrop();
    const outcome = await endProviderSession({ provider, providerSessionId, channel, reattach: true });
    expect(outcome).toMatchObject({ hangup: "ok", observed: true, finalUsageSeconds: 12 });
  });

  it("without re-attach (control lost): hangup only, usage unconfirmed", async () => {
    const { provider, channel, providerSessionId } = await live();
    channel.simulateSidebandDrop();
    const outcome = await endProviderSession({ provider, providerSessionId, channel, reattach: false });
    expect(outcome).toMatchObject({ hangup: "ok", observed: false, finalUsageSeconds: null });
    expect(provider.hangups).toEqual([providerSessionId]);
  });

  it("a refused re-attach still hangs up (bounded, never keeps the call alive)", async () => {
    const provider = new MockRealtimeVoiceProvider({ reattach: "refuse" });
    const { channel, providerSessionId } = await live(provider);
    channel.simulateSidebandDrop();
    const outcome = await endProviderSession({ provider, providerSessionId, channel, reattach: true });
    expect(outcome).toMatchObject({ hangup: "ok", observed: false, finalUsageSeconds: null });
  });

  it("recovery attach to an ended session reports alreadyGone and skips the hangup", async () => {
    const { provider, channel, providerSessionId } = await live();
    channel.simulateSidebandDrop();
    channel.simulateProviderEndedWhileDetached();
    const outcome = await endProviderSession({ provider, providerSessionId, channel: null, reattach: true });
    expect(outcome).toMatchObject({ alreadyGone: true, hangup: "unsupported", finalUsageSeconds: null });
    expect(provider.hangups).toEqual([]);
  });

  it("a failed hangup falls back to the sideband close", async () => {
    const provider = new MockRealtimeVoiceProvider({ failHangup: true });
    const { channel, providerSessionId } = await live(provider);
    channel.setUsageSeconds(8);
    const outcome = await endProviderSession({ provider, providerSessionId, channel, reattach: true });
    expect(outcome).toMatchObject({ hangup: "failed", sidebandClose: true, finalUsageSeconds: 8 });
  });

  it("a provider without the hangup API uses the sideband close", async () => {
    const { provider, channel, providerSessionId } = await live();
    const legacy: RealtimeVoiceProvider = {
      id: provider.id,
      createWebRtcSession: provider.createWebRtcSession.bind(provider),
      attachControlChannel: provider.attachControlChannel.bind(provider),
    };
    channel.setUsageSeconds(5);
    const outcome = await endProviderSession({ provider: legacy, providerSessionId, channel, reattach: true });
    expect(outcome).toMatchObject({ hangup: "unsupported", sidebandClose: true, finalUsageSeconds: 5 });
  });

  it("waits only a bounded time for session.closed", async () => {
    setVoiceTerminationSettingsForTests({ closedWaitMs: 20 });
    const provider = {
      id: "mock",
      createWebRtcSession: async () => ({ providerSessionId: "p", sdpAnswer: "" }),
      attachControlChannel: async () => {
        throw new Error("unused");
      },
      hangupSession: async () => ({ ok: true as const }),
    } as unknown as RealtimeVoiceProvider;
    const silent = {
      providerSessionId: "p",
      isConnected: () => true,
      subscribe: () => () => undefined,
    } as unknown as VoiceControlChannel;
    const started = Date.now();
    const outcome = await endProviderSession({ provider, providerSessionId: "p", channel: silent, reattach: true });
    expect(outcome).toMatchObject({ hangup: "ok", observed: true, finalUsageSeconds: null });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
