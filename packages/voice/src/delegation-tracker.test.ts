import { describe, expect, it } from "vitest";

import { DelegationTracker } from "./delegation-tracker";

describe("DelegationTracker", () => {
  it("accepts appends only while active", () => {
    const tracker = new DelegationTracker();
    tracker.create("d1", 0);
    expect(tracker.acceptAppend("d1")).toEqual({ ok: true });
    tracker.complete("d1", 1);
    expect(tracker.acceptAppend("d1")).toEqual({ ok: false, reason: "completed" });
  });

  it("closes the session and rejects subsequent appends", () => {
    const tracker = new DelegationTracker();
    tracker.create("d1");
    tracker.closeSession();
    expect(tracker.acceptAppend("d1")).toEqual({ ok: false, reason: "session_closed" });
    expect(() => tracker.create("d2")).toThrow(/closed/i);
  });
});
