import { describe, expect, it } from "vitest";

import {
  createWidgetSignature,
  generateWidgetSigningSecret,
  parseWidgetSignatureHeader,
  verifyWidgetSignature,
} from "./widget-signature";

describe("widget signature", () => {
  const secret = generateWidgetSigningSecret();
  const now = new Date("2026-08-24T21:00:00.000Z");
  const timestamp = Math.floor(now.getTime() / 1000);
  const maxSkewSeconds = 300;

  function verify(overrides: Partial<Parameters<typeof verifyWidgetSignature>[0]> = {}) {
    return verifyWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      header: createWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        timestamp,
      }),
      now,
      maxSkewSeconds,
      ...overrides,
    });
  }

  it("round-trips a valid signature", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    expect(verify({ header })).toEqual({ ok: true });
  });

  it("allows the same valid signature to be presented more than once within the skew window", () => {
    // Intentional short-lived replay window — residual abuse is rate-limited.
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });
    expect(verify({ header })).toEqual({ ok: true });
    expect(verify({ header })).toEqual({ ok: true });
  });

  it("rejects a signature older than max skew", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp: timestamp - (maxSkewSeconds + 1),
    });
    expect(verify({ header })).toEqual({ ok: false, reason: "widget_signature_expired" });
  });

  it("rejects a signature too far in the future", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp: timestamp + maxSkewSeconds + 1,
    });
    expect(verify({ header })).toEqual({ ok: false, reason: "widget_signature_expired" });
  });

  it("accepts signatures at the exact skew boundary", () => {
    const past = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp: timestamp - maxSkewSeconds,
    });
    const future = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp: timestamp + maxSkewSeconds,
    });
    expect(verify({ header: past })).toEqual({ ok: true });
    expect(verify({ header: future })).toEqual({ ok: true });
  });

  it("rejects missing, empty, and malformed headers", () => {
    expect(verify({ header: null })).toEqual({
      ok: false,
      reason: "widget_signature_missing_or_malformed",
    });
    expect(verify({ header: "" })).toEqual({
      ok: false,
      reason: "widget_signature_missing_or_malformed",
    });
    expect(verify({ header: "nope" })).toEqual({
      ok: false,
      reason: "widget_signature_missing_or_malformed",
    });
    expect(verify({ header: `t=${timestamp}` })).toEqual({
      ok: false,
      reason: "widget_signature_missing_or_malformed",
    });
    expect(verify({ header: `v1=${"ab".repeat(32)}` })).toEqual({
      ok: false,
      reason: "widget_signature_missing_or_malformed",
    });
    expect(parseWidgetSignatureHeader(`t=1.5,v1=${"ab".repeat(32)}`)).toBeNull();
    expect(parseWidgetSignatureHeader(`t=-1,v1=${"ab".repeat(32)}`)).toBeNull();
    expect(parseWidgetSignatureHeader(`t=0,v1=${"ab".repeat(32)}`)).toBeNull();
    expect(parseWidgetSignatureHeader(`t=abc,v1=${"ab".repeat(32)}`)).toBeNull();
    expect(parseWidgetSignatureHeader(`t=${timestamp},v1=not-hex`)).toBeNull();
  });

  it("rejects when publicId, visitorId, or timestamp binding is wrong", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });

    expect(verify({ header, assistantPublicId: "asst_other" })).toEqual({
      ok: false,
      reason: "widget_signature_invalid",
    });
    expect(verify({ header, visitorId: "visitor99" })).toEqual({
      ok: false,
      reason: "widget_signature_invalid",
    });

    // Same hex but altered timestamp in the header (binding mismatch).
    const otherTs = timestamp - 10;
    const mismatchedTs = header.replace(`t=${timestamp}`, `t=${otherTs}`);
    expect(verify({ header: mismatchedTs })).toEqual({
      ok: false,
      reason: "widget_signature_invalid",
    });
  });

  it("rejects a tampered hex digest", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });
    const tampered = header.replace(/v1=[0-9a-f]+/, (m) =>
      m.endsWith("0") ? `${m.slice(0, -1)}1` : `${m.slice(0, -1)}0`,
    );

    expect(verify({ header: tampered })).toEqual({
      ok: false,
      reason: "widget_signature_invalid",
    });
  });

  it("rejects signatures after the signing secret is rotated", () => {
    const oldSecret = generateWidgetSigningSecret();
    const newSecret = generateWidgetSigningSecret();
    const header = createWidgetSignature({
      secret: oldSecret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });

    expect(
      verifyWidgetSignature({
        secret: newSecret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header,
        now,
        maxSkewSeconds,
      }),
    ).toEqual({ ok: false, reason: "widget_signature_invalid" });
  });

  it("rejects unequal-length digests without string equality", () => {
    // safeEqualHex uses timingSafeEqual on decoded bytes; length mismatch returns false.
    expect(verify({ header: `t=${timestamp},v1=ab` })).toEqual({
      ok: false,
      reason: "widget_signature_invalid",
    });
  });
});
