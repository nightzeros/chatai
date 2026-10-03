import { describe, expect, it } from "vitest";

import { deriveVoicePhase, detectInterruption, voiceEndNotice, type VoiceSignals } from "./voice-state";

const base: VoiceSignals = {
  connection: "connected",
  now: 10_000,
  userVoiceAt: null,
  assistantVoiceAt: null,
  delegationActive: false,
  interruptedAt: null,
};

describe("deriveVoicePhase", () => {
  it("maps connection lifecycle states", () => {
    expect(deriveVoicePhase({ ...base, connection: "idle" })).toBe("idle");
    expect(deriveVoicePhase({ ...base, connection: "connecting" })).toBe("connecting");
    expect(deriveVoicePhase({ ...base, connection: "reconnecting" })).toBe("reconnecting");
    expect(deriveVoicePhase({ ...base, connection: "failed" })).toBe("error");
    expect(deriveVoicePhase({ ...base, connection: "ended" })).toBe("ended");
  });

  it("is listening when connected and quiet", () => {
    expect(deriveVoicePhase(base)).toBe("listening");
  });

  it("prefers delegating over assistant filler audio", () => {
    expect(
      deriveVoicePhase({ ...base, delegationActive: true, assistantVoiceAt: 9_900 }),
    ).toBe("delegating");
    expect(deriveVoicePhase({ ...base, assistantVoiceAt: 9_900 })).toBe("assistant_speaking");
  });

  it("shows user speech over delegation and interruption over everything", () => {
    expect(deriveVoicePhase({ ...base, delegationActive: true, userVoiceAt: 9_900 })).toBe(
      "user_speaking",
    );
    expect(
      deriveVoicePhase({ ...base, userVoiceAt: 9_900, interruptedAt: 9_500 }),
    ).toBe("interrupted");
  });

  it("decays activity after the hold window", () => {
    expect(deriveVoicePhase({ ...base, userVoiceAt: 9_000 })).toBe("listening");
    expect(deriveVoicePhase({ ...base, interruptedAt: 8_000 })).toBe("listening");
  });
});

describe("detectInterruption", () => {
  it("fires only on the rising edge of user speech over assistant audio", () => {
    expect(
      detectInterruption({ userWasActive: false, userIsActive: true, assistantIsActive: true }),
    ).toBe(true);
    expect(
      detectInterruption({ userWasActive: true, userIsActive: true, assistantIsActive: true }),
    ).toBe(false);
    expect(
      detectInterruption({ userWasActive: false, userIsActive: true, assistantIsActive: false }),
    ).toBe(false);
  });
});

describe("voiceEndNotice", () => {
  it("explains a usage-limit end to the owner in minutes, never provider cost", () => {
    const notice = voiceEndNotice("usage_limit")!;
    expect(notice).toMatch(/Voice minutes/);
    expect(notice).not.toMatch(/\$|cost|provider/i);
  });

  it("explains a superseded session and ignores anything else", () => {
    expect(voiceEndNotice("superseded")).toMatch(/newer Voice session/);
    expect(voiceEndNotice(null)).toBeNull();
    expect(voiceEndNotice("close_requested")).toBeNull();
  });
});
