import { describe, expect, it } from "vitest";

import { createVoiceTranscript } from "./voice-transcript";

function simple(turns: ReturnType<ReturnType<typeof createVoiceTranscript>["turns"]>) {
  return turns.map((turn) => [turn.role, turn.text, turn.interrupted] as const);
}

describe("createVoiceTranscript", () => {
  it("keeps user and assistant turns in spoken order", () => {
    const transcript = createVoiceTranscript("s");
    transcript.input("Hi ", 0);
    transcript.input("there", 300);
    transcript.output("Hello! How can I help?", 1_800);
    transcript.input("How many members does Zenith have?", 2_500);
    transcript.output("Zenith has 17 members.", 5_000);

    expect(simple(transcript.turns())).toEqual([
      ["user", "Hi there", false],
      ["assistant", "Hello! How can I help?", false],
      ["user", "How many members does Zenith have?", false],
      ["assistant", "Zenith has 17 members.", false],
    ]);
  });

  it("drops a short backchannel spoken over the assistant", () => {
    const transcript = createVoiceTranscript("s");
    transcript.input("Tell me about Zenith", 0);
    transcript.output("Zenith was founded in 2011 ", 4_000);
    transcript.input("mm-hm", 2_500);
    transcript.output("and has 17 members.", 6_000);

    expect(simple(transcript.turns())).toEqual([
      ["user", "Tell me about Zenith", false],
      ["assistant", "Zenith was founded in 2011 and has 17 members.", false],
    ]);
  });

  it("starts a fresh turn when the user speaks after a backchannel and the assistant finished", () => {
    const transcript = createVoiceTranscript("s");
    transcript.input("Tell me about Zenith", 0);
    transcript.output("Zenith has 17 members.", 4_000);
    transcript.input("mm", 3_000);
    transcript.input("Thanks a lot", 5_000);

    expect(simple(transcript.turns())).toEqual([
      ["user", "Tell me about Zenith", false],
      ["assistant", "Zenith has 17 members.", false],
      ["user", "Thanks a lot", false],
    ]);
  });

  it("treats two or more overlapping words as a barge-in that interrupts the assistant", () => {
    const transcript = createVoiceTranscript("s");
    transcript.input("Tell me about Zenith", 0);
    transcript.output("Zenith was founded in 2011 and", 6_000);
    transcript.input("wait ", 2_000);
    transcript.input("what about pricing", 2_300);
    transcript.output("Sure, pricing starts at ten dollars.", 9_000);

    expect(simple(transcript.turns())).toEqual([
      ["user", "Tell me about Zenith", false],
      ["assistant", "Zenith was founded in 2011 and", true],
      ["user", "wait what about pricing", false],
      ["assistant", "Sure, pricing starts at ten dollars.", false],
    ]);
  });

  it("drops unresolved short overlapping speech when the session finishes", () => {
    const transcript = createVoiceTranscript("s");
    transcript.input("Hello", 0);
    transcript.output("Hi, what can I do for you?", 3_000);
    transcript.input("mm", 2_000);

    expect(simple(transcript.finish())).toEqual([
      ["user", "Hello", false],
      ["assistant", "Hi, what can I do for you?", false],
    ]);
  });

  it("gives every turn a stable, session-scoped id", () => {
    const transcript = createVoiceTranscript("voice_x");
    transcript.input("Hi", 0);
    transcript.output("Hello", 900);
    expect(transcript.turns().map((turn) => turn.id)).toEqual(["voice_x:0", "voice_x:1"]);
  });
});
