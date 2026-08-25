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

  it("round-trips a valid signature", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]+$/);

    expect(
      verifyWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header,
        now,
        maxSkewSeconds: 300,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an expired signature", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp: timestamp - 400,
    });

    expect(
      verifyWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header,
        now,
        maxSkewSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "widget_signature_expired" });
  });

  it("rejects a signature for the wrong assistant", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_other",
      visitorId: "visitor01",
      timestamp,
    });

    expect(
      verifyWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header,
        now,
        maxSkewSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "widget_signature_invalid" });
  });

  it("rejects missing or malformed headers", () => {
    expect(
      verifyWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header: null,
        now,
        maxSkewSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "widget_signature_missing_or_malformed" });

    expect(parseWidgetSignatureHeader("nope")).toBeNull();
  });

  it("rejects a tampered hex digest", () => {
    const header = createWidgetSignature({
      secret,
      assistantPublicId: "asst_public",
      visitorId: "visitor01",
      timestamp,
    });
    const tampered = header.replace(/v1=[0-9a-f]/, (m) =>
      m.endsWith("0") ? `${m.slice(0, -1)}1` : `${m.slice(0, -1)}0`,
    );

    expect(
      verifyWidgetSignature({
        secret,
        assistantPublicId: "asst_public",
        visitorId: "visitor01",
        header: tampered,
        now,
        maxSkewSeconds: 300,
      }),
    ).toEqual({ ok: false, reason: "widget_signature_invalid" });
  });
});
