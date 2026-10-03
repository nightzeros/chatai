import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ALL_FORMATS, EncodedPacketSink, FilePathSource, Input } from "mediabunny";
import { OpusDecoder } from "opus-decoder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { muxOpusPacketsToWebm, readPacketSpool } from "./codec";
import { VoiceSessionRecorder } from "./recorder";
import { FRAME_SAMPLES, SOURCE_RATE, StereoTimeline } from "./timeline";

function tone(freq: number, samples: number, offset = 0): Int16Array {
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * freq * (offset + i)) / SOURCE_RATE));
  }
  return out;
}

/** RMS per 20 ms window of a decoded 48 kHz channel. */
function windowRms(channel: Float32Array): number[] {
  const win = 960;
  const out: number[] = [];
  for (let start = 0; start + win <= channel.length; start += win) {
    let sum = 0;
    for (let i = start; i < start + win; i += 1) sum += channel[i]! * channel[i]!;
    out.push(Math.sqrt(sum / win));
  }
  return out;
}

function firstLoudWindow(rms: number[], from = 0): number {
  for (let i = from; i < rms.length; i += 1) if (rms[i]! > 0.05) return i;
  return -1;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "chatai-rec-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("StereoTimeline", () => {
  it("places visitor audio by arrival, assistant audio by start_ms, and fills gaps with silence", () => {
    let now = 0;
    const tl = new StereoTimeline(() => now, 100);
    now = 20;
    tl.pushInput(tone(440, FRAME_SAMPLES)); // origin = 0, visitor frame 0
    tl.pushOutput(tone(880, FRAME_SAMPLES), 60); // assistant frame 3
    now = 200;
    const frames = tl.drainReady(); // ready up to (200 - 100) ms = 5 frames
    expect(frames).toHaveLength(5);
    expect(frames[0]!.left.some((s) => s !== 0)).toBe(true);
    expect(frames[0]!.right.every((s) => s === 0)).toBe(true);
    expect(frames[1]!.left.every((s) => s === 0)).toBe(true);
    expect(frames[3]!.right.some((s) => s !== 0)).toBe(true);
    expect(frames[3]!.left.every((s) => s === 0)).toBe(true);
  });

  it("re-anchors visitor audio after an arrival gap and shifts late assistant audio forward", () => {
    let now = 20;
    const tl = new StereoTimeline(() => now, 0);
    tl.pushInput(tone(440, FRAME_SAMPLES));
    now = 1_020; // 1 s with no visitor audio
    tl.pushInput(tone(440, FRAME_SAMPLES));
    const frames = tl.drainReady();
    expect(frames).toHaveLength(51);
    expect(frames[1]!.left.every((s) => s === 0)).toBe(true);
    expect(frames[50]!.left.some((s) => s !== 0)).toBe(true);

    // start_ms already emitted: placed at the next frame, not dropped.
    tl.pushOutput(tone(880, FRAME_SAMPLES), 100);
    now = 1_040;
    const next = tl.drainReady();
    expect(next[0]!.right.some((s) => s !== 0)).toBe(true);
  });

  it("drops assistant audio positioned beyond wall-clock at session end (never heard)", () => {
    let now = 20;
    const tl = new StereoTimeline(() => now, 1_500);
    tl.pushInput(tone(440, FRAME_SAMPLES));
    tl.pushOutput(tone(880, SOURCE_RATE * 5), 20); // 5 s generated ahead
    now = 1_020;
    const frames = tl.drainAll();
    expect(frames.length).toBe(51);
  });

  it("keeps memory bounded over a simulated 60-minute stream", () => {
    let now = 0;
    const tl = new StereoTimeline(() => now, 1_500);
    const visitor = tone(440, FRAME_SAMPLES);
    const assistant = tone(880, FRAME_SAMPLES);
    const slots = (tl as unknown as { slots: Map<number, unknown> }).slots;
    let emitted = 0;
    let maxBuffered = 0;
    for (let f = 0; f < 60 * 60 * 50; f += 1) {
      now += 20;
      tl.pushInput(visitor);
      if (f % 3 === 0) tl.pushOutput(assistant, f * 20);
      if (f % 10 === 0) emitted += tl.drainReady().length;
      maxBuffered = Math.max(maxBuffered, slots.size);
    }
    expect(maxBuffered).toBeLessThan(100);
    emitted += tl.drainAll().length;
    expect(emitted).toBe(60 * 60 * 50);
  });
});

describe("recorder → spool → WebM", () => {
  it("produces a seekable stereo WebM/Opus with visitor left, assistant right, time-aligned", async () => {
    let now = 0;
    const spoolPath = path.join(dir, "rec.opus-spool");
    const recorder = await VoiceSessionRecorder.start(spoolPath, {
      now: () => now,
      lagMs: 200,
      autoTick: false,
    });

    // 3 s session. Visitor: speech 0–1 s and a barge-in 1.6–2.4 s (silence otherwise,
    // as a live mic streams). Assistant: speech 1.0–2.0 s, generated ahead in 100 ms bursts.
    for (let f = 0; f < 150; f += 1) {
      now = (f + 1) * 20;
      const ms = f * 20;
      const speaking = ms < 1_000 || (ms >= 1_600 && ms < 2_400);
      recorder.onAudio({
        source: "input",
        pcm: speaking ? tone(440, FRAME_SAMPLES, f * FRAME_SAMPLES) : new Int16Array(FRAME_SAMPLES),
      });
      if (ms >= 900 && ms < 1_900 && ms % 100 === 0) {
        const startMs = ms + 100;
        recorder.onAudio({
          source: "output",
          pcm: tone(880, SOURCE_RATE / 10, (startMs * SOURCE_RATE) / 1000),
          startMs,
          endMs: startMs + 100,
        });
      }
      recorder.tick();
    }
    const stopped = await recorder.stop();
    expect(stopped).toEqual({ ok: true, packets: 150, durationMs: 3_000 });

    const packets = await readPacketSpool(spoolPath);
    expect(packets).toHaveLength(150);
    const webmPath = path.join(dir, "rec.webm");
    const { durationMs } = await muxOpusPacketsToWebm(packets, webmPath, recorder.preSkip);
    expect(durationMs).toBe(3_000);

    const bytes = await readFile(webmPath);
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // EBML
    expect(bytes.includes(Buffer.from([0x1c, 0x53, 0xbb, 0x6b]))).toBe(true); // Cues
    expect(bytes.includes(Buffer.from("OpusHead"))).toBe(true); // CodecPrivate

    const input = new Input({ source: new FilePathSource(webmPath), formats: ALL_FORMATS });
    expect(await input.getMimeType()).toBe('audio/webm; codecs="opus"');
    const track = (await input.getPrimaryAudioTrack())!;
    expect(track.numberOfChannels).toBe(2);
    expect(track.sampleRate).toBe(48_000);
    expect(await input.computeDuration()).toBeCloseTo(3, 1);

    const muxed: Uint8Array[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) muxed.push(packet.data);
    expect(muxed).toHaveLength(150);

    const decoder = new OpusDecoder({ channels: 2, preSkip: recorder.preSkip });
    await decoder.ready;
    const decoded = decoder.decodeFrames(muxed);
    decoder.free();
    const left = windowRms(decoded.channelData[0]!);
    const right = windowRms(decoded.channelData[1]!);

    // Channel separation: each side only carries its own speaker.
    const leftAt = (ms: number) => left[Math.floor(ms / 20)]!;
    const rightAt = (ms: number) => right[Math.floor(ms / 20)]!;
    expect(leftAt(500)).toBeGreaterThan(0.1);
    expect(rightAt(500)).toBeLessThan(0.01);
    expect(leftAt(1_300)).toBeLessThan(0.01);
    expect(rightAt(1_300)).toBeGreaterThan(0.1);
    // Overlap (barge-in): both speakers audible on their own sides.
    expect(leftAt(1_800)).toBeGreaterThan(0.1);
    expect(rightAt(1_800)).toBeGreaterThan(0.1);
    expect(leftAt(2_700)).toBeLessThan(0.01);
    expect(rightAt(2_700)).toBeLessThan(0.01);

    // Alignment within 40 ms of the intended onsets.
    expect(Math.abs(firstLoudWindow(right) * 20 - 1_000)).toBeLessThanOrEqual(40);
    expect(Math.abs(firstLoudWindow(left, 60) * 20 - 1_600)).toBeLessThanOrEqual(40);
  });

  it("V2: stamps provider-clock placement, detects onsets, and ignores wall-clock packet gaps", async () => {
    let now = 0;
    const spoolPath = path.join(dir, "v2.opus-spool");
    const recorder = await VoiceSessionRecorder.start(spoolPath, {
      now: () => now,
      lagMs: 200,
      autoTick: false,
      timelineVersion: 2,
    });
    expect(recorder.timelineVersion).toBe(2);

    // 2 s of provider media: visitor speech 1.0–1.6 s with a 2 s wall-clock packet
    // gap at 1.4 s (provider clock paused). Assistant audio at 1.8–2.0 s arrives as
    // the provider clock reaches it (measured: output never leads the visitor clock).
    for (let f = 0; f < 100; f += 1) {
      now += 20;
      const ms = f * 20;
      if (f === 70) now += 2_000;
      const speaking = ms >= 1_000 && ms < 1_600;
      recorder.onAudio({
        source: "input",
        pcm: speaking ? tone(440, FRAME_SAMPLES, f * FRAME_SAMPLES) : new Int16Array(FRAME_SAMPLES),
      });
      if (ms === 1_980) {
        // GPT-Live streams quiet output frames ahead of speech.
        recorder.onAudio({ source: "output", pcm: new Int16Array(FRAME_SAMPLES), startMs: 1_780, endMs: 1_800 });
        recorder.onAudio({ source: "output", pcm: tone(880, SOURCE_RATE / 5), startMs: 1_800, endMs: 2_000 });
      }
      recorder.tick();
    }
    const stopped = await recorder.stop();
    expect(stopped).toEqual({ ok: true, packets: 100, durationMs: 2_000 });
    expect(recorder.timelineStats).toEqual({ reanchors: 0, reanchoredMs: 0, anchoredReleases: 0, contiguousReleases: 0 });
    expect(recorder.onsets!.input.runs.map((r) => r.startMs)).toEqual([1_000]);
    expect(recorder.onsets!.output.runs.map((r) => r.startMs)).toEqual([1_800]);

    const packets = await readPacketSpool(spoolPath);
    const webmPath = path.join(dir, "v2.webm");
    await muxOpusPacketsToWebm(packets, webmPath, recorder.preSkip);
    const input = new Input({ source: new FilePathSource(webmPath), formats: ALL_FORMATS });
    const track = (await input.getPrimaryAudioTrack())!;
    const muxed: Uint8Array[] = [];
    for await (const packet of new EncodedPacketSink(track).packets()) muxed.push(packet.data);
    const decoder = new OpusDecoder({ channels: 2, preSkip: recorder.preSkip });
    await decoder.ready;
    const decoded = decoder.decodeFrames(muxed);
    decoder.free();
    const left = windowRms(decoded.channelData[0]!);
    const right = windowRms(decoded.channelData[1]!);
    expect(Math.abs(firstLoudWindow(left) * 20 - 1_000)).toBeLessThanOrEqual(40);
    expect(Math.abs(firstLoudWindow(right) * 20 - 1_800)).toBeLessThanOrEqual(40);
  });

  it("V2: a sideband re-attach holds visitor audio and places the backlog on the provider anchor", async () => {
    let now = 0;
    const recorder = await VoiceSessionRecorder.start(path.join(dir, "reattach.opus-spool"), {
      now: () => now,
      lagMs: 0,
      autoTick: false,
      timelineVersion: 2,
    });
    const packet = () => ({ source: "input" as const, pcm: tone(440, FRAME_SAMPLES) });
    for (let f = 0; f < 50; f += 1) {
      now += 20;
      recorder.onAudio(packet());
    }
    recorder.onControl("disconnected");
    now += 4_000;
    recorder.onControl("reattached");
    for (let f = 0; f < 100; f += 1) recorder.onAudio(packet()); // 2 s backlog
    recorder.noteProviderTime(4_000);
    now += 800;
    recorder.onAudio(packet());
    const stopped = await recorder.stop();
    expect(stopped).toMatchObject({ ok: true, durationMs: 4_020 });
    expect(recorder.timelineStats).toMatchObject({ anchoredReleases: 1, reanchoredMs: 1_000 });
  });

  it("V2: an onset-tracking failure only disables onsets; the recording continues", async () => {
    let now = 0;
    const recorder = await VoiceSessionRecorder.start(path.join(dir, "onset-fail.opus-spool"), {
      now: () => now,
      lagMs: 0,
      autoTick: false,
      timelineVersion: 2,
    });
    recorder.onsets!.input.feed = () => {
      throw new Error("boom");
    };
    for (let f = 0; f < 10; f += 1) {
      now += 20;
      recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES) });
      recorder.tick();
    }
    expect(recorder.onsets).toBeNull();
    expect(recorder.active).toBe(true);
    expect(await recorder.stop()).toEqual({ ok: true, packets: 10, durationMs: 200 });
  });

  it("V1 recordings are unchanged: arrival-time placement, no onsets, control timing ignored", async () => {
    let now = 0;
    const recorder = await VoiceSessionRecorder.start(path.join(dir, "v1.opus-spool"), {
      now: () => now,
      lagMs: 0,
      autoTick: false,
    });
    expect(recorder.timelineVersion).toBe(1);
    now = 20;
    recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES) });
    recorder.onControl("disconnected");
    recorder.noteProviderTime(10_000);
    now = 1_020;
    recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES) });
    recorder.tick();
    expect(recorder.onsets).toBeNull();
    expect(recorder.timelineStats).toBeNull();
    // V1 fills the wall-clock gap with silence (Phase 8 behavior).
    expect(await recorder.stop()).toEqual({ ok: true, packets: 51, durationMs: 1_020 });
  });

  it("recovers every complete packet from a spool truncated mid-record (crash)", async () => {
    let now = 0;
    const spoolPath = path.join(dir, "crash.opus-spool");
    const recorder = await VoiceSessionRecorder.start(spoolPath, { now: () => now, lagMs: 0, autoTick: false });
    for (let f = 0; f < 50; f += 1) {
      now = (f + 1) * 20;
      recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES, f * FRAME_SAMPLES) });
      recorder.tick();
    }
    await recorder.stop();
    const full = await readFile(spoolPath);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(spoolPath, full.subarray(0, full.byteLength - 3));
    const packets = await readPacketSpool(spoolPath);
    expect(packets).toHaveLength(49);
    const { durationMs } = await muxOpusPacketsToWebm(packets, path.join(dir, "crash.webm"), recorder.preSkip);
    expect(durationMs).toBe(980);
  });

  it("disables itself on a spool write failure without throwing into the session", async () => {
    let now = 0;
    const recorder = await VoiceSessionRecorder.start(path.join(dir, "fail.opus-spool"), {
      now: () => now,
      lagMs: 0,
      autoTick: false,
    });
    const spool = (recorder as unknown as { spool: { handle: { write: () => Promise<never> } } }).spool;
    spool.handle.write = () => Promise.reject(new Error("ENOSPC"));
    now = 20;
    recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES) });
    recorder.tick();
    await new Promise((r) => setTimeout(r, 0));
    now = 40;
    expect(() => {
      recorder.onAudio({ source: "input", pcm: tone(440, FRAME_SAMPLES) });
      recorder.tick();
    }).not.toThrow();
    const result = await recorder.stop();
    expect(result).toEqual({ ok: false, errorCode: "recording_spool_write_failed" });
  });
});
