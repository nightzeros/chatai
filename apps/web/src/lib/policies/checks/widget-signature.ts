import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WIDGET_SIGNATURE_HEADER = "x-chatai-signature";

export function generateWidgetSigningSecret(): string {
  return randomBytes(32).toString("base64");
}

export function widgetSignaturePayload(
  assistantPublicId: string,
  visitorId: string,
  timestamp: number,
): string {
  return `${assistantPublicId}:${visitorId}:${timestamp}`;
}

export function createWidgetSignature(input: {
  secret: string;
  assistantPublicId: string;
  visitorId: string;
  timestamp: number;
}): string {
  const payload = widgetSignaturePayload(
    input.assistantPublicId,
    input.visitorId,
    input.timestamp,
  );
  const hex = createHmac("sha256", input.secret).update(payload, "utf8").digest("hex");
  return `t=${input.timestamp},v1=${hex}`;
}

export function parseWidgetSignatureHeader(
  header: string | null | undefined,
): { timestamp: number; hex: string } | null {
  if (!header?.trim()) {
    return null;
  }

  const parts = Object.fromEntries(
    header
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf("=");
        if (eq <= 0) return ["", ""];
        return [part.slice(0, eq), part.slice(eq + 1)];
      }),
  );

  const timestamp = Number(parts.t);
  const hex = parts.v1;
  if (!Number.isFinite(timestamp) || !hex || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }

  return { timestamp, hex };
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length || left.length === 0) {
      return false;
    }
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export type VerifyWidgetSignatureInput = {
  secret: string;
  assistantPublicId: string;
  visitorId: string;
  header: string | null | undefined;
  now?: Date;
  maxSkewSeconds: number;
};

export type VerifyWidgetSignatureResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify `X-ChatAI-Signature: t=<unix>,v1=<hex>` over
 * `${assistantPublicId}:${visitorId}:${timestamp}`.
 */
export function verifyWidgetSignature(
  input: VerifyWidgetSignatureInput,
): VerifyWidgetSignatureResult {
  const parsed = parseWidgetSignatureHeader(input.header);
  if (!parsed) {
    return { ok: false, reason: "widget_signature_missing_or_malformed" };
  }

  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > input.maxSkewSeconds) {
    return { ok: false, reason: "widget_signature_expired" };
  }

  const expected = createWidgetSignature({
    secret: input.secret,
    assistantPublicId: input.assistantPublicId,
    visitorId: input.visitorId,
    timestamp: parsed.timestamp,
  });
  const expectedParsed = parseWidgetSignatureHeader(expected);
  if (!expectedParsed || !safeEqualHex(expectedParsed.hex, parsed.hex)) {
    return { ok: false, reason: "widget_signature_invalid" };
  }

  return { ok: true };
}
