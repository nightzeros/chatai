import type { VoiceMediaDeps } from "../voice";

type Listener = (event: unknown) => void;

class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

export class FakeTrack {
  stopped = false;
  enabled = true;
  stop() {
    this.stopped = true;
  }
}

export class FakeChannel extends Emitter {
  /** Simulates a provider event arriving on the `oai-events` data channel. */
  receive(event: Record<string, unknown>) {
    this.dispatch("message", { data: JSON.stringify(event) });
  }
}

export class FakePeer extends Emitter {
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  closed = false;
  readonly channel = new FakeChannel();
  readonly channelLabels: string[] = [];
  private senders: Array<{ track: FakeTrack }> = [];

  addTrack(track: FakeTrack) {
    this.senders.push({ track });
  }
  getSenders() {
    return this.senders;
  }
  createDataChannel(label: string) {
    this.channelLabels.push(label);
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\no=- offer\r\n" };
  }
  async setLocalDescription(description: { type: string; sdp: string }) {
    this.localDescription = description;
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.remoteDescription = description;
  }
  close() {
    this.closed = true;
  }
  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatch("connectionstatechange");
  }
}

export class FakeAudioElement {
  srcObject: unknown = null;
  paused = true;
  muted = false;
  pause() {
    this.paused = true;
  }
  async play() {
    this.paused = false;
  }
}

export type FakeMedia = VoiceMediaDeps & {
  peers: FakePeer[];
  tracks: FakeTrack[];
  audio: FakeAudioElement[];
  audioContexts: Array<{ closed: boolean }>;
  micRequests: number;
};

/** Fake browser media: no real mic, WebRTC or Web Audio. */
export function createFakeMedia(opts: { micError?: Error; micDelay?: Promise<void> } = {}): FakeMedia {
  const media: FakeMedia = {
    peers: [],
    tracks: [],
    audio: [],
    audioContexts: [],
    micRequests: 0,
    async getUserMedia() {
      media.micRequests += 1;
      if (opts.micDelay) await opts.micDelay;
      if (opts.micError) throw opts.micError;
      const track = new FakeTrack();
      media.tracks.push(track);
      return { getTracks: () => [track] } as unknown as MediaStream;
    },
    createPeerConnection() {
      const peer = new FakePeer();
      media.peers.push(peer);
      return peer as unknown as RTCPeerConnection;
    },
    createAudioContext() {
      const ctx = {
        closed: false,
        async close() {
          ctx.closed = true;
        },
        async resume() {},
        createAnalyser() {
          throw new Error("no analyser in tests");
        },
      };
      media.audioContexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    createAudioElement() {
      const audio = new FakeAudioElement();
      media.audio.push(audio);
      return audio as unknown as HTMLAudioElement;
    },
  };
  return media;
}

export const MOCK_SDP_ANSWER = "v=0\r\na=chatai-mock-session:prov_1\r\n";
export const REAL_SDP_ANSWER = "v=0\r\no=- answer\r\n";
