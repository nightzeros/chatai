import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./email";

vi.mock("@/lib/env", () => ({
  env: {
    RESEND_API_KEY: undefined as string | undefined,
    EMAIL_FROM: undefined as string | undefined,
  },
}));

import { env } from "@/lib/env";

describe("sendEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    env.RESEND_API_KEY = undefined;
    env.EMAIL_FROM = undefined;
  });

  it("logs to console when Resend is not configured", async () => {
    const log = vi.fn();
    const result = await sendEmail(
      {
        to: "user@example.com",
        subject: "Reset",
        text: "https://example.com/reset?token=abc",
      },
      { log },
    );

    expect(result).toEqual({ ok: true, transport: "console" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      to: "user@example.com",
      text: expect.stringContaining("token=abc"),
    });
  });

  it("posts to Resend when API key is set", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await sendEmail(
      {
        to: "user@example.com",
        subject: "Reset your ChatAI password",
        text: "Click here",
        html: "<p>Click here</p>",
      },
      {
        resendApiKey: "re_test",
        emailFrom: "ChatAI <noreply@example.com>",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );

    expect(result).toEqual({ ok: true, transport: "resend" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
        }),
      }),
    );

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      from: "ChatAI <noreply@example.com>",
      to: ["user@example.com"],
      subject: "Reset your ChatAI password",
      text: "Click here",
      html: "<p>Click here</p>",
    });
  });

  it("falls back to console when Resend returns an error", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "sandbox recipient only",
    });

    const result = await sendEmail(
      { to: "user@example.com", subject: "Reset", text: "https://example.com/reset?token=abc" },
      { resendApiKey: "re_test", fetchImpl: fetchImpl as unknown as typeof fetch, log },
    );

    expect(result).toEqual({ ok: true, transport: "console" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      text: expect.stringContaining("token=abc"),
    });
  });
});
