import { describe, expect, it } from "vitest";

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import {
  classifyVoiceTurn,
  endVoiceGate,
  isVoiceOutputWithheld,
  setVoiceGate,
  subscribeVoiceGate,
  voiceGateOf,
  type VoiceGateDecision,
} from "./turn-gate";

describe("classifyVoiceTurn", () => {
  it.each([
    "Hi",
    "Hey, what's up",
    "Hi there, how are you doing today",
    "Good morning!",
    "Thanks so much",
    "Thank you",
    "Thanks, that's all",
    "Goodbye!",
    "okay",
    "Okay, cool.",
    "got it",
    "mhm",
    "mm hmm",
    "uh huh",
    "alright",
    "I see",
  ])("%j is small talk the live model may answer", (text) => {
    expect(classifyVoiceTurn(text)).toBe("social");
  });

  it.each([
    "",
    "   ",
    "I'm hungry",
    "Eating",
    "What do you mean?",
    "Can you say that again?",
    "Repeat that",
    "I want to cook today, can you help me",
    "What's the best laptop for gaming?",
    "Hi, what does the Pro plan cost?",
    "okay, and what about shipping",
    "Tell me about yourself",
    "pizza",
  ])("%j goes to the backend", (text) => {
    expect(classifyVoiceTurn(text)).toBe("backend");
  });

  it("an answer to an assistant question accepts or answers it: backend", () => {
    expect(classifyVoiceTurn("yes")).toBe("social");
    expect(classifyVoiceTurn("yes", "Would you like to hear about our plans?")).toBe("backend");
    expect(classifyVoiceTurn("sure", "Want me to check that?")).toBe("backend");
    expect(classifyVoiceTurn("thanks", "The Pro plan is $20 a month.")).toBe("social");
  });
});

describe("voice gate state", () => {
  it("starts closed and withholds output until an open decision", () => {
    const session = fakeVoiceRuntime();
    expect(voiceGateOf(session).decision).toEqual({ seq: 0, state: "closed", reason: "start", inputEndMs: null });
    expect(isVoiceOutputWithheld(session)).toBe(true);
    setVoiceGate(session, "open", "social");
    expect(isVoiceOutputWithheld(session)).toBe(false);
  });

  it("broadcasts transitions and every open, never closed→closed, with the latest input end", () => {
    const session = fakeVoiceRuntime();
    const seen: Array<VoiceGateDecision | null> = [];
    subscribeVoiceGate(session, (decision) => seen.push(decision));

    setVoiceGate(session, "closed", "pending_backend");
    session.inputFragments.push({ text: "Hi", startMs: 100, endMs: 500 });
    setVoiceGate(session, "open", "social");
    session.inputFragments.push({ text: " there", startMs: 500, endMs: 800 });
    setVoiceGate(session, "open", "social");
    setVoiceGate(session, "closed", "user_speaking");
    setVoiceGate(session, "closed", "pending_backend");

    expect(seen).toEqual([
      { seq: 1, state: "open", reason: "social", inputEndMs: 500 },
      { seq: 2, state: "open", reason: "social", inputEndMs: 800 },
      { seq: 3, state: "closed", reason: "user_speaking", inputEndMs: 800 },
    ]);
    expect(voiceGateOf(session).decision).toMatchObject({ seq: 3, reason: "pending_backend" });
  });

  it("ending closes the gate, notifies every stream once and ignores later decisions", () => {
    const session = fakeVoiceRuntime();
    const seen: Array<VoiceGateDecision | null> = [];
    subscribeVoiceGate(session, (decision) => seen.push(decision));
    setVoiceGate(session, "open", "backend_answer");

    endVoiceGate(session);
    endVoiceGate(session);
    setVoiceGate(session, "open", "system");
    expect(seen.at(-1)).toBeNull();
    expect(seen.filter((decision) => decision === null)).toHaveLength(1);
    expect(isVoiceOutputWithheld(session)).toBe(true);

    const late: Array<VoiceGateDecision | null> = [];
    subscribeVoiceGate(session, (decision) => late.push(decision));
    expect(late).toEqual([null]);
  });

  it("a broken listener never affects the others", () => {
    const session = fakeVoiceRuntime();
    const seen: string[] = [];
    subscribeVoiceGate(session, () => {
      throw new Error("stream gone");
    });
    subscribeVoiceGate(session, (decision) => seen.push(decision?.state ?? "end"));
    setVoiceGate(session, "open", "social");
    expect(seen).toEqual(["open"]);
  });
});
