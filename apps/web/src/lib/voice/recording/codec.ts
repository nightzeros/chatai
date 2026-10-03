import { open, readFile, type FileHandle } from "node:fs/promises";

import { createOpusEncoder, FRAME, type OpusPacketEncoder } from "@audio/encode-opus/core";
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  FilePathTarget,
  Output,
  WebMOutputFormat,
} from "mediabunny";

import { FRAME_MS, FRAME_SAMPLES, SOURCE_RATE, Upsampler2x, type StereoFrame } from "./timeline";

export const RECORDING_CONTENT_TYPE = "audio/webm";
/** Speech-tuned stereo Opus: ~0.36 MB/min. */
export const OPUS_BITRATE_KBPS = 48;
const OPUS_COMPLEXITY = 5;
const OPUS_RATE = 48_000;

/** Stereo Opus encoder fed with 24 kHz frames (visitor left, assistant right). */
export class StereoOpusEncoder {
  private readonly left = new Upsampler2x();
  private readonly right = new Upsampler2x();
  private readonly interleaved = new Float32Array(FRAME * 2);

  private constructor(private readonly encoder: OpusPacketEncoder) {}

  static async create(): Promise<StereoOpusEncoder> {
    const encoder = await createOpusEncoder({
      channels: 2,
      bitrate: OPUS_BITRATE_KBPS,
      application: "voip",
      complexity: OPUS_COMPLEXITY,
    });
    return new StereoOpusEncoder(encoder);
  }

  /** Encoder delay in 48 kHz samples (Opus pre-skip). */
  get preSkip(): number {
    return this.encoder.lookahead;
  }

  encode(frame: StereoFrame): Uint8Array {
    if (frame.left.length !== FRAME_SAMPLES || frame.right.length !== FRAME_SAMPLES) {
      throw new Error("Recorder frames must hold 20 ms per channel.");
    }
    this.left.process(frame.left, this.interleaved, 0, 2);
    this.right.process(frame.right, this.interleaved, 1, 2);
    return this.encoder.encode(this.interleaved);
  }

  free(): void {
    this.encoder.free();
  }
}

/** RFC 7845 identification header, used as the WebM CodecPrivate. */
export function opusHead(preSkip: number, channels = 2): Uint8Array {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  view.setUint8(8, 1);
  view.setUint8(9, channels);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, SOURCE_RATE, true);
  view.setInt16(16, 0, true);
  view.setUint8(18, 0);
  return head;
}

/**
 * Append-only spool of compressed Opus packets (one per 20 ms frame, in order):
 * `[u16 LE length][packet]`. A crash can only truncate the final record, which
 * the reader drops, so everything before it stays recoverable.
 */
export class PacketSpoolWriter {
  private chain: Promise<void> = Promise.resolve();
  private error: Error | null = null;
  packets = 0;
  bytes = 0;

  private constructor(private readonly handle: FileHandle) {}

  static async open(path: string): Promise<PacketSpoolWriter> {
    return new PacketSpoolWriter(await open(path, "a"));
  }

  get failure(): Error | null {
    return this.error;
  }

  append(packets: Uint8Array[]): void {
    if (packets.length === 0 || this.error) return;
    const size = packets.reduce((sum, p) => sum + 2 + p.byteLength, 0);
    const buf = Buffer.allocUnsafe(size);
    let offset = 0;
    for (const packet of packets) {
      if (packet.byteLength > 0xffff) throw new Error("Opus packet too large for spool record.");
      buf.writeUInt16LE(packet.byteLength, offset);
      buf.set(packet, offset + 2);
      offset += 2 + packet.byteLength;
    }
    this.packets += packets.length;
    this.bytes += size;
    this.chain = this.chain
      .then(async () => {
        await this.handle.write(buf);
      })
      .catch((err: unknown) => {
        this.error = err instanceof Error ? err : new Error(String(err));
      });
  }

  /** Waits for pending writes; rejects if any write failed. */
  async close(): Promise<void> {
    await this.chain;
    await this.handle.close().catch(() => undefined);
    if (this.error) throw this.error;
  }
}

export async function readPacketSpool(path: string): Promise<Uint8Array[]> {
  const buf = await readFile(path);
  const packets: Uint8Array[] = [];
  let offset = 0;
  while (offset + 2 <= buf.byteLength) {
    const len = buf.readUInt16LE(offset);
    if (offset + 2 + len > buf.byteLength) break;
    packets.push(new Uint8Array(buf.subarray(offset + 2, offset + 2 + len)));
    offset += 2 + len;
  }
  return packets;
}

/** Mux spooled packets into a seekable WebM (Duration + Cues). Returns the duration in ms. */
export async function muxOpusPacketsToWebm(
  packets: Uint8Array[],
  outPath: string,
  preSkip: number,
): Promise<{ durationMs: number }> {
  if (packets.length === 0) throw new Error("No audio packets to mux.");
  const output = new Output({ format: new WebMOutputFormat(), target: new FilePathTarget(outPath) });
  const source = new EncodedAudioPacketSource("opus");
  output.addAudioTrack(source);
  await output.start();
  const frameSec = FRAME_MS / 1000;
  for (let i = 0; i < packets.length; i += 1) {
    await source.add(
      new EncodedPacket(packets[i]!, "key", i * frameSec, frameSec),
      i === 0
        ? {
            decoderConfig: {
              codec: "opus",
              numberOfChannels: 2,
              sampleRate: OPUS_RATE,
              description: opusHead(preSkip),
            },
          }
        : undefined,
    );
  }
  await output.finalize();
  return { durationMs: packets.length * FRAME_MS };
}
