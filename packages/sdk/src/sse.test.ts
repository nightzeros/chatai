import { describe, expect, it } from "vitest";

import { parseSseFrame } from "./sse";

describe("parseSseFrame", () => {
  it("parses token events", () => {
    expect(parseSseFrame('data: {"type":"token","text":"Hi"}')).toEqual({
      type: "token",
      text: "Hi",
    });
  });

  it("ignores non-data frames", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
  });
});
